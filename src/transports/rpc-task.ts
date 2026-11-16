import { ResServerTools } from "../res-server-tools";
import { RpcServerDispatcher } from "./dispatcher";
import { ToolRpcContext, RpcStatusCode, RpcError } from "./models";

/**
 * 框架内置标准心跳及任务状态轮询端点
 * 基于 RESTful 规范定义
 */
export class RpcTaskResource extends ResServerTools {
  constructor(name: string = 'rpcTask', options: any = {}) {
    super(name, {
      ...options,
      description: 'Built-in tracking endpoint for active RPC tasks',
    });
  }

  /**
   * Status Polling Endpoint (GET /api/rpcTask/:resId)
   */
  get(params: any, context?: ToolRpcContext) {
    const resId = this.getResId(params, context);
    if (!resId) throw new RpcError("Missing task ID (resId)", RpcStatusCode.BAD_REQUEST);

    const dispatcher = (context?.dispatcher || this.ctx?.dispatcher) as RpcServerDispatcher;
    if (!dispatcher) {
      throw new RpcError("Dispatcher context missing. Are you running under V2 Dispatcher?", RpcStatusCode.INTERNAL_ERROR);
    }

    const task = dispatcher.tracker.get(resId);
    if (!task) {
       throw new RpcError(`Task Not Found or Expired: ${resId}`, RpcStatusCode.NOT_FOUND);
    }

    if (task.status === 'processing') {
       throw new RpcError("Keep Polling", RpcStatusCode.PROCESSING);
    } else if (task.status === 'error' || task.status === 'aborted') {
       const errMessage = task.error ? (task.error.message || String(task.error)) : "Task aborted";
       throw new RpcError(errMessage, task.status === 'error' ? RpcStatusCode.INTERNAL_ERROR : RpcStatusCode.TERMINATED);
    }

    // 关键：增加获取计数，可能会触发 'once' 策略的逻辑删除
    task.fetchCount++;

    // 透明返回后台任务的执行结果
    return task.result;
  }

  /**
   * Cancel Task Endpoint (POST /api/rpcTask/:resId?act=$cancel)
   */
  $cancel(params: any, context?: ToolRpcContext) {
    const resId = this.getResId(params, context);
    if (!resId) throw new RpcError("Missing task ID (resId)", RpcStatusCode.BAD_REQUEST);

    const dispatcher = (context?.dispatcher || this.ctx?.dispatcher) as RpcServerDispatcher;
    if (!dispatcher) {
       throw new RpcError("Dispatcher context missing", RpcStatusCode.INTERNAL_ERROR);
    }

    const task = dispatcher.tracker.get(resId);
    if (!task) {
       throw new RpcError(`Task Not Found or Expired: ${resId}`, RpcStatusCode.NOT_FOUND);
    }

    task.abort("Client requested cancellation via rpcTask API");

    // 取消之后账本就得清（issue #11）：`handle.abort()` 只跑工具的 cleanup 钩子，
    // 不注销条目；而原来那次 dispatch 早在返回 102 时就结束，`checkImmediateCleanup` 不会再跑，
    // 残留条目只能等 tracker 的 60s 兜底扇描。
    // 已 aborted 的任务被 GET 只会回 TERMINATED，留着没有任何取回价值。
    // （不是所有 abort 都能这么删：硬死线 / Background Guard 中止的任务，客户端还要靠轮询
    // 读到终态，所以这条只在“客户端显式取消”这个入口上生效。）
    dispatcher.tracker.remove(resId);

    return { success: true };
  }
}
