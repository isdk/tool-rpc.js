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

/**
 * 单个工具条目的形态归工具自己定（`toJSON()` 是它的约定），框架不裁剪字段——
 * **只有一个例外：函数体**（issue #2）。
 *
 * `ToolFunc.toJSON()` 会把 `func` 序列成源码字符串（那是 `allowExportFunc` 的本地执行通道），
 * 所以「照工具自己的 `toJSON()` 回」就等于把实现源码发到发现端点。`ServerTools.toJSON()` 早就
 * 知道这一点（`if (!item.allowExportFunc) delete item.func`）；枚举路径以前不可达，所以从没暴露。
 * 这里与它对齐：默认剥掉 `func`，`allowExportFunc: true` 才导出。
 *
 * 框架取用的每一条都过这里：枚举出的清单、`act: 'get'` 的单条，以及**注册表自带
 * `toJSON()` 返回来的每一条**（见 `manifestItems`，issue #9）。
 */
export function manifestItem(tool: any): any {
  const item = (tool && typeof tool.toJSON === 'function') ? tool.toJSON() : tool;

  if (!item || typeof item !== 'object' || Array.isArray(item) || item.func === undefined) {
    return item;
  }

  // 导出与否看工具本身（`toJSON()` 的输出不保证带上这个字段）
  if (tool?.allowExportFunc === true || item.allowExportFunc === true) {return item;}

  // 副本上删：不能改动工具自己的对象（`toJSON()` 也可能直接回实例本身）
  const copy: any = { ...item };
  delete copy.func;
  return copy;
}

/**
 * 把注册表自己交的整张清单过一遍 `manifestItem`（issue #9）。
 *
 * 为什么需要它：清单合并时，会 `toJSON()` 的那一层是**返回值原样合并**的。只剥枚举路径的话，
 * 一个自带 `toJSON()` 的注册表（或覆写了 `toJSON()` 的子类）仍然能把函数体发到发现端点——
 * 于是「不导出 `func`」只是每个注册表的自觉，而不是框架的保证。Core 自己的
 * `ServerTools.toJSON()` 早就剥了，所以内置路径看上去是安全的，缺口容易看漏。
 *
 * 形态不变：只逐条目剥，不改键名、不改顺序、不增删条目。`manifestItem` 对已剥过的条目
 * 是幂等的，所以内置清单过这一遍不会变样。清单可以是 Promise（异步 `toJSON()`），
 * 那时返回 Promise，由合并层照原来的方式等。
 */
export function manifestItems(json: any): any {
  if (!json || typeof json !== 'object') {return json;}
  if (typeof json.then === 'function') {return Promise.resolve(json).then(manifestItems);}

  const out: Record<string, any> = {};
  for (const [id, item] of Object.entries(json)) {
    out[id] = manifestItem(item);
  }
  return out;
}

/**
 * 框架内置的发现工具：列出**本次请求命中的那个前缀**所服务的工具清单。
 *
 * 它不持有工具清单，只从执行上下文里拿本次解析出的注册表（`ctx.registry`，
 * 由 dispatcher 按「前缀 claim → transport → dispatcher」的顺序备好），
 * 所以多前缀多注册表时各前缀列各自的工具，互不串。
 *
 * 它**不声明自己的超时**（issue #8）：列清单一般是纯内存操作，但它与业务工具受同一套死线管，
 * `globalTimeout` 兜得到它——没有旁路，也没有豁免。以前这里写 `timeout: 0` 并注释成
 * 「不被 globalTimeout 掩」，而实现是 `... || globalTimeout`，两边说的不是一回事；
 * 现在 `0` 真的是「不要死线」，内置工具就更不该拿它当「没配」写。
 * 要单独定它的死线就传 `options.timeout`。
 */
export class RpcApisResource extends ServerTools {
  constructor(name: string = RPC_APIS_TOOL_ID, options: any = {}) {
    super(name, {
      ...options,
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
      // 注册表自带的清单也要剥函数体（issue #9）：形态归它，`func` 不归它
      if (json) {return manifestItems(json);}
    }

    const out: Record<string, any> = {};
    for (const [name, tool] of registryEntries(registry)) {
      out[name] = manifestItem(tool);
    }
    return out;
  }
}
