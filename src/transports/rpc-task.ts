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
    return { success: true };
  }
}
