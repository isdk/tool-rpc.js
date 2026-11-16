import { ToolFunc } from "@isdk/tool-func";
import { RemoteToolFuncSchema, RemoteFuncItem } from "./consts";
import { ToolRpcContext } from "./transports/models";
import { injectV1ContextToParams, bridgeContextToV1Params } from "./transports/compat";

/**
 * ServerFuncParams 定义。
 */
export interface ServerFuncParams {
  _req?: any;
  _res?: any;
  _signal?: AbortSignal;
  [name: string]: any;
}

export interface ServerFuncItem extends RemoteFuncItem {
  allowExportFunc?: boolean;
}

export declare interface ServerTools extends ServerFuncItem {
  [name: string]: any;
}

/**
 * ServerTools: RPC 服务端工具基类
 *
 * [V2 架构方针：原子化与纯净]
 * 基类不再假设任何路由逻辑（ID 或 Act），仅提供运行环境支持。
 */
export class ServerTools extends ToolFunc {
  /** [V2] 归一化执行上下文 */
  public ctx?: ToolRpcContext;
  /** 控制是否开启向下兼容注入。 */
  public enableLegacyCompat = true;

  static toJSON() {
    const result: { [name: string]: ServerTools } = {}
    for (const name in this.items) {
      let item: any = this.items[name];
      const isExactType = (item instanceof this) && item.isApi !== false;
      const isBaseApi = item.isApi && !(item instanceof ServerTools) && (this === ServerTools);

      if (isExactType || isBaseApi) {
        if (!item.allowExportFunc) {
          item = item.toJSON()
          delete item.func;
        }
        result[name] = item;
      }
    }
    return result;
  }

  /**
   * [V2 标准执行入口]
   */
  run(params: ServerFuncParams, context?: ToolRpcContext) {
    // 影子实例调用此方法时，this.ctx 可能已由 tool-func 设置
    // 这里仅在 context 传入且未设置时作为备选注入
    if (context && !this.ctx) {
      this.ctx = context;
    }

    // legacy compat 注入读的 ctx：调用方递的优先，否则读自己（影子实例）身上的。
    // dispatcher 现在只 `with(context)`、不再把 context 当第二个参数递下来（issue #14），
    // 所以这条回退就是 `_req`/`_res`/`_signal` 不丢的那根线。
    const compatCtx = context || this.ctx;

    if (this.enableLegacyCompat && compatCtx) {
      // 集中管理：将新架构信息回灌给旧版 Params，适配那些仍依赖 params 内部数据的旧工具。
      injectV1ContextToParams(params, compatCtx);
      bridgeContextToV1Params(compatCtx, params);
    }

    // 往下传的必须仍是调用方的 `context`，不是 compatCtx：把 `this.ctx` 补进去等于告诉
    // tool-func「这一层还要隔离」，一次调用就会开两个调用作用域（issue #14）。
    // 如果没有重写 func，则调用基类的 run，它会处理 positional 参数等逻辑。
    return super.run(params, context);
  }

  /**
   * 业务实现函数模板。
   */
  func(params: ServerFuncParams, context?: ToolRpcContext): Promise<any> | any {
    return super.run(params, context);
  }
}

export const ServerToolFuncSchema = { ...RemoteToolFuncSchema }
ServerTools.defineProperties(ServerTools, ServerToolFuncSchema)
