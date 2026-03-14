import { ToolFunc } from "@isdk/tool-func";
import { RemoteToolFuncSchema, RemoteFuncItem } from "./consts";
import { ToolRpcContext } from "./transportsV2/models";
import { injectV1ContextToParams, bridgeContextToV1Params } from "./transportsV2/compat";

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
  private static _apiRoot?: string;
  /** [V2] 归一化执行上下文 */
  public ctx?: ToolRpcContext;
  /** 控制是否开启向下兼容注入。 */
  public enableLegacyCompat = true;

  static get apiRoot() { return this._apiRoot; }
  static setApiRoot(v: string) { this._apiRoot = v; }

  static toJSON() {
    const result:{[name:string]: ServerTools} = {}
    for (const name in this.items) {
      let item: any = this.items[name];
      const isExactType = (item instanceof this) && ((item.constructor as any).toJSON === this.toJSON) && item.isApi !== false;
      const isBaseApi = item.isApi && !(item instanceof ServerTools);

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
    if (context) {
      this.ctx = context;
    }

    if (this.enableLegacyCompat && context) {
      // 集中管理：将新架构信息回灌给旧版 Params，适配那些仍依赖 params 内部数据的旧工具。
      injectV1ContextToParams(params, context);
      bridgeContextToV1Params(context, params);
    }

    return this.func(params, context);
  }

  /**
   * 业务实现函数模板。
   */
  func(params: ServerFuncParams, context?: ToolRpcContext): Promise<any>|any {
      return super.run(params, context);
  }
}

export const ServerToolFuncSchema = { ...RemoteToolFuncSchema }
ServerTools.defineProperties(ServerTools, ServerToolFuncSchema)
