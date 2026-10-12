import { ServerTools } from '../server-tools';
import { ToolRpcContext, RpcError, RpcStatusCode, RPC_APIS_TOOL_ID } from './models';

// 常量本体在 models.ts（客户端侧要用它，而那边不能把服务端工具类带进浏览器包）。
// 这里转出口，是为了「内置工具与它的 id」在源码里读起来是一件事。
export { RPC_APIS_TOOL_ID };

/**
 * 框架内置的发现工具：列出**本次请求命中的那个前缀**所服务的工具清单。
 *
 * 它不持有工具清单，只从执行上下文里拿本次解析出的注册表（`ctx.registry`，
 * 由 dispatcher 按「前缀 claim → transport → dispatcher」的顺序备好），
 * 所以多前缀多注册表时各前缀列各自的工具，互不串。
 *
 * `timeout: 0`：列清单是纯内存操作，不该占用业务超时预算，也不该被 `globalTimeout` 掐。
 */
export class RpcApisResource extends ServerTools {
  constructor(name: string = RPC_APIS_TOOL_ID, options: any = {}) {
    super(name, {
      ...options,
      timeout: 0,
      description: 'Built-in discovery endpoint: lists the tools served by the matched route prefix',
    });
  }

  /**
   * `act: 'get'` 且带 `resId` → 只回那一个工具；其余情况回全量清单。
   */
  run(params: any, context?: ToolRpcContext) {
    const registry: any = context?.registry ?? context?.dispatcher?.registry;
    if (!registry) {
      throw new RpcError('Discovery: no tool registry mounted for this route', RpcStatusCode.INTERNAL_ERROR);
    }

    const resId = context?.resId ?? params?.resId;
    if (context?.act === 'get' && resId) {
      const tool = typeof registry.get === 'function' ? registry.get(resId) : registry[resId];
      if (!tool) {
        throw new RpcError(`Tool not found: ${resId}`, RpcStatusCode.NOT_FOUND);
      }
      return this.toItem(tool);
    }

    return this.listRegistry(registry);
  }

  /** 清单形态：优先用注册表自己的 `toJSON()`（`ServerTools` 那种），否则按形态枚举。 */
  private listRegistry(registry: any): Record<string, any> {
    if (typeof registry.toJSON === 'function') {
      return registry.toJSON();
    }

    const out: Record<string, any> = {};

    // ToolFunc 家族：静态 items 是注册表本体
    const items = registry.items;
    if (items && typeof items === 'object') {
      for (const name of Object.keys(items)) {
        const item = items[name];
        if (item && item.isApi === false) {continue;}
        out[name] = this.toItem(item);
      }
      return out;
    }

    if (typeof registry.entries === 'function') {
      for (const [name, tool] of registry.entries()) {
        out[name] = this.toItem(tool);
      }
      return out;
    }

    for (const name of Object.keys(registry)) {
      if (typeof registry[name] === 'function' || (registry[name] && typeof registry[name] === 'object')) {
        out[name] = this.toItem(registry[name]);
      }
    }
    return out;
  }

  /** 单个工具条目的形态归工具自己定（`toJSON()` 是它的约定），框架不裁剪字段。 */
  private toItem(tool: any): any {
    if (tool && typeof tool.toJSON === 'function') {return tool.toJSON();}
    return tool;
  }
}
