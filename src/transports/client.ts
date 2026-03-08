import { Funcs } from "@isdk/tool-func";
import { ActionName } from '../consts';
import { ClientTools } from "../client-tools";
import { IToolTransport, ToolTransport } from "./base";

/**
 * Defines the public interface for a client-side transport,
 * responsible for communicating with a ServerTransport.
 */
export interface IClientToolTransport extends IToolTransport {
  /**
   * Connects to the server's discovery endpoint to get the list of available tools.
   * @param options Additional options for the discovery call.
   * @returns A promise that resolves to a map of tool function metadata.
   */
  loadApis(options?: any): Promise<Funcs>;

  mount(clientTools: typeof ClientTools, apiPrefix?: string, options?: any): any|Promise<any>;

  /**
   * Fetches data from the server.
   * @param name The name of the tool function to fetch.
   * @param args The object parameters to pass to the server.
   * @param act The action to perform on the server.
   * @param subName The name of the sub-resource to fetch.
   * @param options Additional options for the fetch call.
   * @param toolTimeout Optional timeout from tool metadata.
   * @returns A promise that resolves with the fetched data.
   */
  fetch(name: string, args?: any, act?: ActionName | string, subName?: any, options?: any, toolTimeout?: any): any|Promise<any>;

  [name: string]: any;
}

/**
 * A concrete client transport implementation that uses the browser/node `fetch` API.
 */
export abstract class ClientToolTransport extends ToolTransport implements IClientToolTransport {
  declare apiRoot: string;
  declare Tools: typeof ClientTools


  constructor(apiRoot: string) {
    if (!apiRoot) {
      throw new Error('apiRoot is required for HttpClientTransport');
    }
    super();
    this.setApiRoot(apiRoot);
  }

  async _mount(clientTools: typeof ClientTools, apiPrefix: string, options?: any) {
    clientTools.setTransport(this);
    return clientTools.loadFrom();
  }

  /**
   * Connects to the server's discovery endpoint to get the list of available tools.
   * @param options Additional options for the discovery call.
   * @returns A promise that resolves to a map of tool function metadata.
   */
  public async loadApis(options?: any): Promise<Funcs> {
    const fetchOptions = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    return this.fetch('', undefined, 'get', undefined, fetchOptions)
  }

  async fetch(name: string, args?: any, act?: ActionName | string, subName?: any, fetchOptions?: any, toolTimeout?: any) {
    fetchOptions = {...this.options, ...fetchOptions}

    // Handle timeout calculation: take the minimum of transport's default, tool metadata, and manual options
    let timeout: any = fetchOptions.timeout;
    let transportTimeout: any = this.options?.timeout;

    if (transportTimeout !== undefined || timeout !== undefined || toolTimeout !== undefined) {
      const getVal = (t: any) => typeof t === 'number' ? t : t?.value;
      const t1 = getVal(transportTimeout);
      const t2 = getVal(timeout);
      const t3 = getVal(toolTimeout);

      let effectiveTimeoutVal: number | undefined;
      const vals = [t1, t2, t3].filter(v => v !== undefined) as number[];
      if (vals.length > 0) {
        effectiveTimeoutVal = Math.min(...vals);
      }

      if (effectiveTimeoutVal !== undefined) {
        if (typeof timeout === 'object' && timeout !== null) {
          fetchOptions.timeout = { ...timeout, value: effectiveTimeoutVal };
        } else if (typeof toolTimeout === 'object' && toolTimeout !== null) {
          fetchOptions.timeout = { ...toolTimeout, value: effectiveTimeoutVal };
        } else if (typeof transportTimeout === 'object' && transportTimeout !== null) {
          fetchOptions.timeout = { ...transportTimeout, value: effectiveTimeoutVal };
        } else {
          fetchOptions.timeout = effectiveTimeoutVal;
        }
      }
    }

    const res = await this._fetch(name, args, act, subName, fetchOptions)

    if (args?.stream) {
      return res
    }
    const result = await this.toObject(res, args)
    return result
  }

  public abstract _fetch(name: string, args?: any, act?: ActionName | string, subName?: any, fetchOptions?: any): any|Promise<any>;
  public abstract toObject(res: any, args?: any): any|Promise<any>;
}
