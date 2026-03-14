import { ResServerTools } from "../res-server-tools";
import { RpcServerDispatcher } from "./dispatcher";
import { ToolRpcContext } from "./models";

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
    if (!resId) throw new Error("Missing task ID (resId)");

    const dispatcher = (context?.dispatcher || this.ctx?.dispatcher) as RpcServerDispatcher;
    if (!dispatcher) {
      const err: any = new Error("Dispatcher context missing. Are you running under V2 Dispatcher?");
      err.code = 500;
      throw err;
    }

    const task = dispatcher.tracker.get(resId);
    if (!task) {
       const err: any = new Error(`Task Not Found or Expired: ${resId}`);
       err.code = 404;
       throw err;
    }

    if (task.status === 'processing') {
       const err: any = new Error("Keep Polling");
       err.code = 102;
       err.status = 'processing';
       throw err;
    } else if (task.status === 'error' || task.status === 'aborted') {
       const err: any = new Error(task.error ? (task.error.message || task.error) : "Task aborted");
       err.code = task.status === 'error' ? 500 : 408;
       err.status = task.status;
       throw err;
    }

    // 透明返回后台任务的执行结果
    return task.result;
  }

  /**
   * Cancel Task Endpoint (POST /api/rpcTask/:resId?act=$cancel)
   */
  $cancel(params: any, context?: ToolRpcContext) {
    const resId = this.getResId(params, context);
    if (!resId) throw new Error("Missing task ID (resId)");

    const dispatcher = (context?.dispatcher || this.ctx?.dispatcher) as RpcServerDispatcher;
    if (!dispatcher) {
       const err: any = new Error("Dispatcher context missing");
       err.code = 500;
       throw err;
    }

    const task = dispatcher.tracker.get(resId);
    if (!task) {
       const err: any = new Error(`Task Not Found or Expired: ${resId}`);
       err.code = 404;
       throw err;
    }

    task.abort("Client requested cancellation via rpcTask API");
    return { success: true };
  }
}
