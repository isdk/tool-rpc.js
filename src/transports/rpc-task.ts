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
       const stateErr = new RpcError(errMessage, task.status === 'error' ? RpcStatusCode.INTERNAL_ERROR : RpcStatusCode.TERMINATED);
       // 这是账本里的终态，不是这次轮询调用自己的失败——不带这个标记，`handleError` 会把 408
       // 折成 504「响应超时」，客户端就分不清「任务被掐了」与「服务端没及时回」（issue #13）。
       stateErr.isTaskState = true;
       throw stateErr;
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

    // 账本去留交给工具自己的 retention 策略（issue #13）。
    // 以前这里是无条件 `tracker.remove(resId)`，那会绕开 `shouldCleanup()`：
    // `Permanent` 或数值保留期里的条目被取消就当场蒸发，客户端再也问不到「这次取消到底停住了没有」
    // （对比：硬死线 / Background Guard 中止的条目是留着的，GET 回 408——同一个终态两种可见性）。
    // `abort()` 已经把 `completedAt` 打在取消那一刻，所以保留期是从取消时开始计时。
    // 默认（None）依旧当场注销——#11 的残留问题就在那条路径上，不回归。
    if (task.shouldCleanup(Date.now())) {
      dispatcher.tracker.remove(resId);
    }

    return { success: true };
  }
}
