import { RpcStatusCode, RpcError, RPC_DEFAULTS } from './models';

export interface RpcDeadlineHooks {
  /** 当 Soft Deadline (102) 触及时触发 */
  onResponseTimeout?: () => void;
  /** 当 Hard Deadline (408) 触及时触发 */
  onHardDeadline?: (reason: RpcError) => void;
}

/**
 * @file 双级死线控制器 (RpcDeadlineGuard)
 * 统一管控服务端响应超时 (102) 与硬执行死线 (408/Signal Abort)
 */
export class RpcDeadlineGuard {
  private softTimer?: NodeJS.Timeout;
  private hardTimer?: NodeJS.Timeout;
  private graceTimer?: NodeJS.Timeout;
  private rejector?: (reason?: any) => void;
  private promise: Promise<never>;

  constructor(
    private readonly timeoutMs: number,
    private readonly hooks: RpcDeadlineHooks = {},
    /** 硬超时绝对值，若不提供则不开启硬超时处理 */
    private readonly hardTimeoutMs?: number,
    /** 硬超时触发后报错延迟 (ms) */
    private readonly terminationGraceMs: number = RPC_DEFAULTS.TERMINATION_GRACE_MS
  ) {
    this.promise = new Promise((_, reject) => {
      this.rejector = reject;
    });
  }

  /**
   * 启动看门狗并返回可竞争的 Promise。
   */
  public start(): Promise<never> {
    // 1. 设置 Soft Deadline (响应超时，通常触发 102)
    if (this.timeoutMs > 0 && (!this.hardTimeoutMs || this.timeoutMs < this.hardTimeoutMs)) {
      this.softTimer = setTimeout(() => {
        this.hooks.onResponseTimeout?.();
        const err = new RpcError('Response Timeout (Soft)', RpcStatusCode.PROCESSING);
        this.rejector?.(err);
      }, this.timeoutMs);
    }

    // 2. 设置 Hard Deadline (硬执行死线)
    if (this.hardTimeoutMs && this.hardTimeoutMs > 0) {
      this.hardTimer = setTimeout(() => {
        const err = new RpcError('Hard Deadline Reached (Terminated)', RpcStatusCode.TERMINATED);
        
        // [延迟中止机制]：首先执行钩子（如调用 aborter.abort()）
        this.hooks.onHardDeadline?.(err);
        
        // 随后等待宽限期，给予业务清理时间
        this.graceTimer = setTimeout(() => {
          this.rejector?.(err);
        }, this.terminationGraceMs);
      }, this.hardTimeoutMs);
    }

    return this.promise;
  }

  /**
   * 提供给外部进行 race 的原始 Promise
   */
  public getPromise(): Promise<never> {
    return this.promise;
  }

  /**
   * 正常结束时清理所有定时器
   */
  public cancel() {
    if (this.softTimer) clearTimeout(this.softTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.softTimer = undefined;
    this.hardTimer = undefined;
    this.graceTimer = undefined;
    this.rejector = undefined;
  }
}
