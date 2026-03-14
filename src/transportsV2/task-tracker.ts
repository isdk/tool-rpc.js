/**
 * @file RpcActiveTaskTracker 以及 ActiveTaskHandle
 * 负责管控挂起任务生命周期与心跳 (TTL) 机制
 */

export class ActiveTaskHandle {
   public lastAccessed: number = Date.now();
   public status: 'processing' | 'completed' | 'error' | 'aborted' = 'processing';
   public result?: any;
   public error?: any;
   
   constructor(
       public readonly requestId: string,
       public readonly promise: Promise<any>,
       public readonly aborter: AbortController,
       public readonly isStream: boolean,
       public readonly onCleanup: () => void
   ) {
      this.promise.then(res => {
         this.status = 'completed';
         this.result = res;
      }).catch(err => {
         // 处理中止的情况
         if (this.aborter.signal.aborted || err?.name === 'AbortError') {
           this.status = 'aborted';
         } else {
           this.status = 'error';
           this.error = err;
         }
      });
   }

   /** 刷新心跳 TTL */
   public touch() {
     this.lastAccessed = Date.now();
   }

   /** 主动中止任务 */
   public abort(reason?: any) {
     if (this.status !== 'processing') return;
     this.aborter.abort(reason);
     this.status = 'aborted';
     this.onCleanup();
   }
}

export class RpcActiveTaskTracker {
  private tasks = new Map<string, ActiveTaskHandle>();
  private sweepInterval?: NodeJS.Timeout | any;

  /**
   * @param ttlMs 默认 5 分钟 (300000ms)，超过此时间未被查询的心跳将被干掉。
   */
  constructor(public readonly ttlMs: number = 5 * 60 * 1000) {
    this.startSweep();
  }

  public add(requestId: string, handle: ActiveTaskHandle) {
    this.tasks.set(requestId, handle);
    handle.touch();
  }

  public get(requestId: string): ActiveTaskHandle | undefined {
    const handle = this.tasks.get(requestId);
    if (handle) {
      handle.touch(); // 每次访问状态，自动触发心跳续命
    }
    return handle;
  }

  public remove(requestId: string) {
    this.tasks.delete(requestId);
  }

  private startSweep() {
    // 每一分钟扫描一次过期任务
    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, handle] of this.tasks.entries()) {
        if (now - handle.lastAccessed > this.ttlMs) {
           // TTL 到期，客户端被视为已失联，回收资源
           handle.abort(new Error(`Client TTL Heartbeat Expired for task ${id}`));
           this.tasks.delete(id);
        }
      }
    }, 60000);
    
    // 避免阻止 Node.js 进程退出
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
