/**
 * @file 双级死线控制器 (RpcDeadlineGuard)
 * 控制服务端是否继续在后台挂起该业务
 */

export class RpcDeadlineGuard {
  private timer: NodeJS.Timeout | any;
  private rejector?: (reason?: any) => void;

  constructor(
    private readonly timeoutMs: number,
    private readonly hooks: {
      onResponseTimeout: () => void;
    }
  ) {}

  public getPromise(): Promise<never> {
    return new Promise((_, reject) => {
      this.rejector = reject;
      this.timer = setTimeout(() => {
        this.hooks.onResponseTimeout();
        // 专门抛出 102 给外层
        const err: any = new Error('Processing / Keep-Alive');
        err.code = 102;
        err.status = 'processing';
        if (this.rejector) this.rejector(err);
      }, this.timeoutMs);
    });
  }

  /**
   * 清洗掉定时器，配合 Promise.race 使用
   */
  public cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.rejector = undefined;
  }
}
