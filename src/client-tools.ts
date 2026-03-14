import { throwError } from "@isdk/common-error";
import { Funcs, ToolFunc } from "@isdk/tool-func";
import { RemoteToolFuncSchema, type RemoteFuncItem, type ActionName } from "./consts";
import type { IClientToolTransport } from "./transportsV2/client";
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
export interface ClientFuncItem extends RemoteFuncItem {}

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

  private static _transport: IClientToolTransport;

  /**
   * Gets the root URL for API endpoints from the configured transport.
   * This is used as the base for constructing request URLs.
   */
  static get apiRoot() {
    if (!this._transport) {throwError(NoTransportErrorMsg, 'ClientTools')}
    return this._transport.apiRoot
  }

  /**
   * Injects the client-side transport implementation. This is a crucial step
   * to enable communication with the server.
   * @param {IClientToolTransport} transport - The transport instance to use for all client-server communication.
   */
  static setTransport(transport: IClientToolTransport) {
    if (transport) {
      this._transport = transport;
    }
  }

  static get transport() {
    return this._transport;
  }

  /**
   * Loads tool definitions from the remote server via the configured transport.
   * This method populates the local `ToolFunc` registry with `ClientTools` stubs.
   * @param items - Optional map of tool function metadata.
   * @param options - Additional options for the discovery call (e.g., timeout).
   */
  static async loadFrom(items?: Funcs, options?: any) {
    if (!items) {
      if (!this._transport) {
        throwError(NoTransportErrorMsg, 'ClientTools');
      }
      items = await this._transport.loadApis(options);
    }
    if (items) this.loadFromSync(items);
    return items;
  }

  /**
   * Synchronously loads tool definitions from a provided object, registering
   * each one as a `ClientTools` instance.
   * @param items - A map of tool function metadata, typically from a server.
   */
  static loadFromSync(items: Funcs) {
    for (const name in items) {
      const item: any = this.get(name);
      const funcItem = items[name] as ClientFuncItem;
      if (!item) {
        this.register(funcItem);
      } else if (item instanceof ClientTools) {
        item.assign(funcItem);
      } else {
        throwError(`${name} already registered as ${item.constructor.name}`, 'ClientTools');
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
   * Gets the root URL for API endpoints from the configured transport.
   * This is used as the base for constructing request URLs.
   */
  get apiRoot() {
    const ctor = this.constructor as typeof ClientTools
    return ctor.apiRoot
  }

  async fetch(objParam?: any, act?: ActionName, subName?: any, fetchOptions?: any) {
    const ctor = this.constructor as typeof ClientTools
    if (ctor._transport) {
      // Merge fetchOptions with this.ctx (from tool-func)
      fetchOptions = defaultsDeep(fetchOptions, this.ctx, this.fetchOptions)
      return ctor._transport.fetch(this.name!, objParam, act, subName, fetchOptions, this.timeout)
    } else {
      throwError(NoTransportErrorMsg, 'ClientTools');
    }
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
export const ClientToolFuncSchema =  { ...RemoteToolFuncSchema }

ClientTools.defineProperties(ClientTools, ClientToolFuncSchema)
