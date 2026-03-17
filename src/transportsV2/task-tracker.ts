import {
  RpcTaskRetention,
  RpcTaskRetentionMode,
  RpcTaskRetentionConfig,
  RPC_DEFAULTS,
  RpcStatusCode,
  RpcError
} from './models';

/**
 * RpcActiveTaskHandle 负责单个活动任务的执行状态记录、结果缓存与清理策略判定
 */
export class RpcActiveTaskHandle {
  /** 最后一次被外部 (如心跳或状态查询) 访问的时间戳 */
  public lastAccessed: number = Date.now();
  /** 任务执行状态 */
  public status: 'processing' | 'completed' | 'error' | 'aborted' = 'processing';
  /** 任务完成时间戳 */
  public completedAt?: number;
  /** 任务结果数据 */
  public result?: any;
  /** 任务错误对象 */
  public error?: any;
  /** 任务被成功获取 (GET) 的次数 */
  public fetchCount: number = 0;
  /** 任务保留策略 */
  public retention: RpcTaskRetentionConfig;
  /** [流式专用] 标记流是否仍在传输中 */
  public streamPending: boolean = false;
  /** [流式专用] 持有输出流引用以便中止 */
  private outputStream?: ReadableStream;

  constructor(
    public readonly requestId: string,
    public readonly promise: Promise<any>,
    public readonly aborter: AbortController,
    public readonly isStream: boolean,
    public readonly onCleanup: () => void,
    retention?: RpcTaskRetention
  ) {
    // 归一化保留策略配置
    this.retention = this.normalizeRetention(retention);
    this.streamPending = isStream; // 初始化时如果是流式任务，则标记为挂起

    // [调试] 监听中止信号以立即更新状态
    if (this.aborter.signal.aborted) {
      this.handleAbort(this.aborter.signal.reason);
    } else {
      this.aborter.signal.addEventListener('abort', () => this.handleAbort(this.aborter.signal.reason), { once: true });
    }

    this.promise.then(res => {
      if (this.status !== 'processing') return;
      this.status = 'completed';
      this.result = res;
      this.completedAt = Date.now();
    }).catch(err => {
      if (this.status !== 'processing') return;
      // 处理中止的情况
      if (this.aborter.signal.aborted || err?.name === 'AbortError' || err?.code === RpcStatusCode.TERMINATED) {
        this.status = 'aborted';
      } else {
        this.status = 'error';
        this.error = err;
      }
      this.completedAt = Date.now();
      // 如果发生错误，流也必定终止
      this.streamPending = false;
    });
  }

  public setOutputStream(stream: ReadableStream) {
    this.outputStream = stream;
    this.streamPending = true;
  }

  public markStreamFinished() {
    this.streamPending = false;
    // 更新完成时间，确保 retention 从流结束时开始计时
    this.completedAt = Date.now();
  }

  private handleAbort(reason?: any) {
    // 只要任务未终结，或者虽然 Promise 完成但流还在挂起，都视为可中止
    if (this.status !== 'processing' && !this.streamPending) return;

    this.status = 'aborted';
    this.completedAt = Date.now();
    this.streamPending = false; // 中止意味着流也断了

    if (this.outputStream) {
      this.outputStream.cancel(reason || 'Task Aborted').catch((e: any) => {
        console.error(`[Handle:${this.requestId}] outputStream Cancel failed: ${e.message}`);
      });
    }

    this.onCleanup();
  }

  private normalizeRetention(r?: RpcTaskRetention): RpcTaskRetentionConfig {
    if (r === undefined) return { mode: RpcTaskRetentionMode.None };
    if (typeof r === 'object') return { onceFallbackMs: RPC_DEFAULTS.ONCE_FALLBACK_MS, ...r };
    return { mode: r, onceFallbackMs: RPC_DEFAULTS.ONCE_FALLBACK_MS };
  }

  /** 刷新心跳 TTL */
  public touch() {
    this.lastAccessed = Date.now();
  }

  /** 主动中止任务 */
  public abort(reason?: any) {
    if (this.status !== 'processing' && !this.streamPending) return;
    this.aborter.abort(reason);
    // handleAbort 会通过事件监听器被调用
  }

  /**
   * 判定当前任务是否符合清理条件
   * @param now 当前时间戳 (由 Tracker 统一传入)
   */
  public shouldCleanup(now: number): boolean {
    const isProcessing = this.status === 'processing';

    // 如果任务还在处理中，或者流还在传输中，则不清理
    if (isProcessing || this.streamPending) return false;
    const age = now - (this.completedAt || now);
    const { mode, onceFallbackMs, maxRetentionMs } = this.retention;

    if (maxRetentionMs && age > maxRetentionMs) return true;

    if (mode === RpcTaskRetentionMode.None) {
      return true;
    }

    if (mode === RpcTaskRetentionMode.Once) {
      return this.fetchCount > 0 || (onceFallbackMs! > 0 && age > onceFallbackMs!);
    }

    if (typeof mode === 'number' && mode > 0) {
      return age > mode;
    }

    return false;
  }
}

/**
 * RpcActiveTaskTracker 负责管控挂起任务账本生命周期、ID 唯一性校验与全局心跳 (TTL) 扫描
 */
export class RpcActiveTaskTracker {
  private tasks = new Map<string, RpcActiveTaskHandle>();
  private sweepInterval?: NodeJS.Timeout | any;

  /**
   * @param ttlMs 默认 5 分钟 (300000ms)，超过此时间未被查询的心跳将被干掉。
   */
  constructor(public readonly ttlMs: number = 5 * 60 * 1000) {
    this.startSweep();
  }

  /**
   * 登记新任务。包含 Request ID 唯一性校验。
   */
  public add(requestId: string, handle: RpcActiveTaskHandle) {
    if (this.tasks.has(requestId)) {
      throw new RpcError(`Conflict: Request ID "${requestId}" is already in use`, RpcStatusCode.CONFLICT);
    }
    this.tasks.set(requestId, handle);
    handle.touch();
  }

  public get(requestId: string): RpcActiveTaskHandle | undefined {
    const handle = this.tasks.get(requestId);
    if (handle) {
      handle.touch();
    }
    return handle;
  }

  public remove(requestId: string) {
    this.tasks.delete(requestId);
  }

  private startSweep() {
    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, handle] of this.tasks.entries()) {
        if (handle.shouldCleanup(now)) {
          this.remove(id);
        } else if (handle.status === 'processing' && now - handle.lastAccessed > this.ttlMs) {
          handle.abort(new Error(`Client TTL Heartbeat Expired for task ${id}`));
          this.remove(id);
        }
      }
    }, 60000);

    if (this.sweepInterval?.unref) {
      this.sweepInterval.unref();
    }
  }

  public stop() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
    }
    for (const handle of this.tasks.values()) {
      handle.abort(new Error('Task Tracker is stopping'));
    }
    this.tasks.clear();
  }
}
