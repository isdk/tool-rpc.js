import { throwError } from "@isdk/common-error";
import { Funcs, ToolFunc } from "@isdk/tool-func";
import { RemoteToolFuncSchema, type RemoteFuncItem, type ActionName } from "./consts";
import type { IClientToolTransport } from "./transports/client";
import { RpcTransportManager } from "./transports/manager";
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

const NoTransportErrorMsg = 'A client transport has not been set. Use ClientTools.setTransport() or transport.mount(ClientTools) first.';

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
   * @deprecated Use RpcTransportManager.instance.register(transport) or manager.getClient(apiUrl)
   * @param {IClientToolTransport} transport - The transport instance to use.
   */
  static setTransport(transport: IClientToolTransport) {
    if (transport) {
      RpcTransportManager.instance.register(transport);
      if (typeof transport.mount === 'function') {
        transport.mount(this);
      }
    }
  }

  /**
   * @deprecated Use RpcTransportManager.instance.getClient(apiUrl)
   */
  static get transport() {
    // This is problematic for multiple transports, returning a guess or throwing
    console.warn('ClientTools.transport is deprecated. Use instance.transport or manager.getClient(apiUrl)');
    return (this as any)._transport;
  }

  /**
   * Loads tool definitions from the remote server via the configured transport.
   * This method populates the local `ToolFunc` registry with `ClientTools` stubs.
   * @param items - Optional map of tool function metadata.
   * @param options - Additional options for the discovery call (e.g., timeout, apiUrl).
   */
  static async loadFrom(items?: Funcs, options?: any) {
    const apiUrl = options?.apiUrl || this.apiUrl;
    if (!items) {
      if (!apiUrl) {
        throwError('apiUrl is required for ClientTools.loadFrom when items is not provided', 'ClientTools');
      }
      const transport = RpcTransportManager.instance.getClient(apiUrl!, options);
      items = await transport.loadApis(options);
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
      return RpcTransportManager.instance.getClient(apiUrl);
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
    const transport = RpcTransportManager.instance.getClient(apiUrl, fetchOptions);
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
