import { ServerTools } from '../server-tools';
import { ToolRpcContext, RpcError, RpcStatusCode, RPC_APIS_TOOL_ID } from './models';

// 常量本体在 models.ts（客户端侧要用它，而那边不能把服务端工具类带进浏览器包）。
// 这里转出口，是为了「内置工具与它的 id」在源码里读起来是一件事。
export { RPC_APIS_TOOL_ID };

/**
 * 一个注册表**层**在没有 `toJSON()` 时能列出的 `[工具 id, 工具]` 对。
 *
 * 形态优先级：静态 `items`（ToolFunc 家族）→ `entries()`（Map 形状）→ 自有键（普通对象映射）。
 * 认不出任何可枚举形态就是空生成器，不抛错——列不出清单是挂载姿势的问题，
 * 由调用方决定回空清单还是报错。
 *
 * 为什么导出：服务端 transport 的**注册表视图**（`ServerToolTransport.requestRegistry`）
 * 也要枚举同样的三种形态，两处必须同一套规则，否则「直接挂 dispatcher 的注册表」和
 * 「经 transport 挂」会列出不同的工具。
 */
export function* registryEntries(registry: any): Generator<[string, any]> {
  if (!registry) {return;}

  // ToolFunc 家族：静态 items 是注册表本体
  const items = registry.items;
  if (items && typeof items === 'object') {
    for (const name of Object.keys(items)) {
      const item = items[name];
      if (item && item.isApi === false) {continue;}
      yield [name, item];
    }
    return;
  }

  if (typeof registry.entries === 'function') {
    yield* registry.entries();
    return;
  }

  for (const name of Object.keys(registry)) {
    const tool = registry[name];
    if (typeof tool === 'function' || (tool && typeof tool === 'object')) {
      yield [name, tool];
    }
  }
}

/** 单个工具条目的形态归工具自己定（`toJSON()` 是它的约定），框架不裁剪字段。 */
export function manifestItem(tool: any): any {
  if (tool && typeof tool.toJSON === 'function') {return tool.toJSON();}
  return tool;
}

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
      return manifestItem(tool);
    }

    return this.listRegistry(registry);
  }

  /**
   * 清单形态：优先用注册表自己的 `toJSON()`（`ServerTools` 那种，可能是 Promise，
   * 交给 dispatcher 等），否则按形态枚举。
   *
   * `toJSON()` 存在但**回空**（`undefined` / `null`）时不算清单，继续往下枚举：
   * 服务端 transport 的注册表视图会替各层包一个 `toJSON`，各层都不会 `toJSON` 时
   * 它只能回空——那时枚举分支才是真正的答案（issue #1）。
   */
  private listRegistry(registry: any): Record<string, any> | Promise<Record<string, any>> {
    if (typeof registry.toJSON === 'function') {
      const json = registry.toJSON();
      if (json) {return json;}
    }

    const out: Record<string, any> = {};
    for (const [name, tool] of registryEntries(registry)) {
      out[name] = manifestItem(tool);
    }
    return out;
  }
}
