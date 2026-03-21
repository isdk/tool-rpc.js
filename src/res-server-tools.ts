import { type FuncParams, type FuncItem } from "@isdk/tool-func";
import { type ActionName, ActionNames } from "./consts";
import { RpcMethodsServerFuncParams, RpcMethodsServerTool } from './rpc-methods-server-tool';
import { ToolRpcContext } from "./transports/models";

export interface ResServerFuncParams extends RpcMethodsServerFuncParams {
  id?: string | number
  // the value
  val?: any
}

export interface ResServerTools {
  get?(params: ResServerFuncParams, context?: ToolRpcContext): any
  post?(params: ResServerFuncParams, context?: ToolRpcContext): any
  put?(params: ResServerFuncParams, context?: ToolRpcContext): any
  delete?(params: ResServerFuncParams, context?: ToolRpcContext): any
  list?(params?: ResServerFuncParams, context?: ToolRpcContext): any
}

/**
 * ResServerTools: 专门处理资源 ID 路由的类
 */
export class ResServerTools extends RpcMethodsServerTool {
  static SpecialRpcMethodNames = ActionNames as any
  action: ActionName = 'res'
  params: FuncParams = {
    // 默认允许传入数组一次性取多个！
    'id': { type: 'string' },
    'val': { type: 'any' },
  }

  constructor(name: string | Function | FuncItem, options: FuncItem | any = {}) {
    super(name, options)
  }

  /**
   * 仅在 Res 类及其派生类中启用资源 ID 获取
   */
  getResId(params: any, context?: ToolRpcContext): string | undefined {
    const ctx = context || this.ctx;
    // 优先从 V2 Context 的 resId 提取
    return ctx?.resId;
  }

  /**
   * 确定执行的方法
   */
  getMethodFromParams(params: ResServerFuncParams, context?: ToolRpcContext) {
    // 1. 优先使用 RpcMethods 层的 Act (Action)
    const act = this.getRpcAct(params, context);
    if (act) return act;

    // 2. 否则根据环境猜测逻辑动作
    const ctx = context || this.ctx;
    // V2 架构下，HTTP Method 已归一化到 headers['x-http-method']
    let method = ctx?.headers?.['x-http-method'] as string;

    // 兼容遗留的物理对象访问
    if (!method && ctx?.req?.method) {
      method = ctx.req.method;
    }

    method = method?.toLowerCase();

    if (method === 'get' && this.getResId(params, context) === undefined) {
      method = 'list';
    }
    return method;
  }

  /**
   * 资源 ID 映射逻辑：将协议层的 resId 灌回给业务层的 params.id
   */
  castParams(params: ResServerFuncParams, context?: ToolRpcContext) {
    const resId = this.getResId(params, context);
    if (resId !== undefined) {
      params.id = this.cast('id', resId);
    }
    return params;
  }
}
