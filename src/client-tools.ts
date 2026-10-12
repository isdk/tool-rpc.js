import { throwError } from "@isdk/common-error";
import { Funcs, ToolFunc } from "@isdk/tool-func";
import { RemoteToolFuncSchema, type RemoteFuncItem, type ActionName } from "./consts";
import type { IClientToolTransport } from "./transports/client";
import { RpcClientTransportManager } from "./transports/client-manager";
import { defaultsDeep } from "lodash-es";

// * Declaration merging to extend the `ClientTools` class with `ClientFuncItem` properties.
export declare interface ClientTools extends ClientFuncItem {
  [name: string]: any;
}

export declare namespace ClientTools {
  /**
   * Gets a registered `ClientTools` instance by name.
   * @param name - The name of the tool function.
   * @returns The `ClientTools` instance.
   */
  function get(name: string): ClientTools;
}

/**
 * Alias for `RemoteFuncItem` on the client side.
 */
export interface ClientFuncItem extends RemoteFuncItem { }

// const NoTransportErrorMsg = 'A client transport has not been set. Use ClientTools.setTransport() or transport.mount(ClientTools) first.';

/**
 * Represents a client-side proxy for a remote tool function.
 *
 * A `ClientTools` instance is a `ToolFunc` that, when executed, does not run
 * local code. Instead, it serializes the parameters and uses an injected
 * transport layer (`IClientToolTransport`) to make a remote procedure call
 * to its corresponding `ServerTools` counterpart.
 *
 * These tools are typically created dynamically by loading definitions from a server.
 */
export class ClientTools extends ToolFunc {
  // the default action name
  declare static action?: ActionName | string;

  /**
   * The default API URL for this tools class.
   * If set, loadFrom and fetch will use this URL to find the transport.
   */
  static apiUrl?: string;

  /**
   * The default fetch options for this tools class.
   */
  static fetchOptions?: any;

  /**
   * Creates a scoped version of this Service class bound to a specific API URL.
   * This allows the same service definition to be used with multiple backends or protocols
   * without creating manual subclasses.
   *
   * @param apiUrl - The target API URL.
   * @param options - Optional configuration for the transport or discovery.
   * @returns A new anonymous class inheriting from the current one, with its own apiUrl and items.
   */
  static connect<T extends typeof ClientTools>(this: T, apiUrl: string, options?: any): T {
    const BoundService = class extends (this as any) { } as any;
    BoundService.apiUrl = apiUrl;
    BoundService.items = {}; // Scope isolation for discovered stubs
    if (options) BoundService.fetchOptions = options;
    return BoundService as T;
  }

  /**
   * Injects the client-side transport implementation.
   *
   * @deprecated V2 按 `apiUrl` 寻址，不必再往工具类上注入 transport。现在怎么写：
   *
   *   1）常规（只有地址）——transport 由 `RpcClientTransportManager` 按 scheme 自己建：
   *      `const Srv = MyClientTools.connect('http://localhost:3000/api')`（或直接 `MyClientTools.apiUrl = '…'`），
   *      再 `await Srv.loadFrom()`。自定义协议先 `RpcClientTransportManager.bindScheme('wechat', WechatClientTransport)`。
   *
   *   2）已经自己构造好了一个 transport（mailbox 要 `clientAddress`、自定义协议要带选项）：
   *      `RpcClientTransportManager.instance.register(clientTransport)`，再 `MyClientTools.apiUrl = clientTransport.apiUrl`。
   *
   * 本方法就是上面第 2 组（`register(transport)` + 把 `transport.apiUrl` 写进类的 `apiUrl`），
   * 只是它还会顺带调同样已废弃的 `transport.mount(Class)`（那个 mount 现在也只干一件事：把 apiUrl 写到类上）。
   * 区别只在绑定方式：旧写法把一个 transport
   * 全局绑到一个类上，多个后端就得互相覆盖；新写法里地址在类（或 `connect()` 出的子类）上，多个后端互不干扰。
   *
   * @param transport - The transport instance to use.
   */
  static setTransport(transport: IClientToolTransport) {
    if (transport) {
      RpcClientTransportManager.instance.register(transport);
      if (typeof transport.mount === 'function') {
        transport.mount(this);
      }
    }
  }

  /**
   * @deprecated 类上不存 transport——同一个类可以对着多个后端。要拿本次调用实际用的 transport：
   * `RpcClientTransportManager.instance.getClient(apiUrl)`（`apiUrl` 就是 `ClientTools.apiUrl` 或实例上的）；
   * 实例上直接用 `someTool.transport`。
   */
  static get transport() {
    // This is problematic for multiple transports, returning a guess or throwing
    console.warn('ClientTools.transport is deprecated. Use instance.transport or RpcClientTransportManager.instance.getClient(apiUrl)');
    return (this as any)._transport;
  }

  /**
   * Loads tool definitions from the remote server via the configured transport.
   * This method populates the local `ToolFunc` registry with `ClientTools` stubs.
   * @param items - Optional map of tool function metadata.
   * @param options - Additional options for the discovery call (e.g., timeout, apiUrl, headers).
   *   类级 `fetchOptions`（如 `headers` 里的凭证）会作为默认值合并进来：发现端点是框架的内置 API，
   *   装了身份策略后它同样要过认证。
   */
  static async loadFrom(items?: Funcs, options?: any) {
    const apiUrl = options?.apiUrl || this.apiUrl;
    if (!items) {
      if (!apiUrl) {
        throwError('apiUrl is required for ClientTools.loadFrom when items is not provided', 'ClientTools');
      }
      const transport = RpcClientTransportManager.instance.getClient(apiUrl!, options);
      // 发现端点是框架自有的内置 API：装了身份策略后它也要过认证，所以它用与业务调用同一份
      // 类级 `fetchOptions`（凭证就在那里），否则 `loadFrom()` 会在 401 上拿不到工具清单。
      items = await transport.loadApis(defaultsDeep(options, this.fetchOptions));
      if (!this.apiUrl) this.apiUrl = apiUrl;
    }
    if (items) this.loadFromSync(items, apiUrl);
    return items;
  }

  /**
   * Synchronously loads tool definitions from a provided object, registering
   * each one as a `ClientTools` instance.
   * @param items - A map of tool function metadata, typically from a server.
   * @param apiUrl - The API URL to associate with these tools.
   */
  static loadFromSync(items: Funcs, apiUrl?: string) {
    for (const name in items) {
      let item: any = this.get(name);
      const funcItem = items[name] as ClientFuncItem;
      if (!item) {
        item = this.register(funcItem);
      } else if (item instanceof ClientTools) {
        item.assign(funcItem);
      } else {
        throwError(`${name} already registered as ${item.constructor.name}`, 'ClientTools');
      }

      if (item instanceof ClientTools && (apiUrl || this.apiUrl)) {
        item.apiUrl = apiUrl || this.apiUrl;
      }
    }
  }

  static async fetch(name: string, objParam?: any, ...args: any[]) {
    const func = this.get(name)
    if (func) {
      if (func.fetch) return func.fetch(objParam, ...args)
    }
  }

  /**
   * @deprecated Use apiUrl instead.
   */
  get apiRoot() {
    return this.apiUrl;
  }

  get apiUrl(): string | undefined {
    return (this as any)._apiUrl || (this.constructor as any).apiUrl;
  }

  set apiUrl(v: string | undefined) {
    (this as any)._apiUrl = v;
  }

  /**
   * Gets the transport instance for this tool.
   */
  get transport(): IClientToolTransport | undefined {
    const apiUrl = this.apiUrl;
    if (apiUrl) {
      return RpcClientTransportManager.instance.getClient(apiUrl);
    }
  }

  async fetch(objParam?: any, act?: ActionName, subName?: any, fetchOptions?: any) {
    // Merge fetchOptions with this.ctx (from tool-func) and class-level defaults
    const classDefaults = (this.constructor as any).fetchOptions;
    fetchOptions = defaultsDeep(fetchOptions, this.ctx, this.fetchOptions, classDefaults)
    const apiUrl = fetchOptions.apiUrl || this.apiUrl;
    if (!apiUrl) {
      throwError('apiUrl is required for ClientTools.fetch', 'ClientTools');
    }
    const transport = RpcClientTransportManager.instance.getClient(apiUrl, fetchOptions);
    const result = await transport.fetch(this.name!, objParam, act, subName, fetchOptions, this.timeout)
    return result
  }

  /**
   * The core implementation for a client-side tool. When a `ClientTools` instance
   * is "run", this `func` method is executed. It delegates the call to the
   * configured transport, which handles the network communication.
   *
   * @param objParam - The parameters to send to the remote tool.
   * @returns The result from the remote tool.
   */
  async func(objParam: any) {
    const res = await this.fetch(objParam)
    return res
  }
}

/**
 * The schema definition for `ClientTools` properties.
 * @internal
 */
export const ClientToolFuncSchema = { ...RemoteToolFuncSchema }

ClientTools.defineProperties(ClientTools, ClientToolFuncSchema)
