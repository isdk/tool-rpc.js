import { Funcs } from "@isdk/tool-func";
import { ActionName } from '../consts';
import { IToolTransport, ToolTransport, ToolTransportOptions } from "./base";
import { RPC_HEADERS, RPC_DEFAULTS } from "./models";

export interface ClientToolTransportOptions extends ToolTransportOptions {
}

export interface IClientToolTransport extends IToolTransport {
  loadApis(options?: any): Promise<Funcs>;
  fetch(name: string, args?: any, act?: ActionName | string, subName?: any, options?: any, toolTimeout?: any): any | Promise<any>;
  [name: string]: any;
}

export abstract class ClientToolTransport extends ToolTransport implements IClientToolTransport {
  declare apiUrl: string;
  declare options?: ClientToolTransportOptions;

  constructor(apiUrl: string, options?: ClientToolTransportOptions) {
    if (!apiUrl) throw new Error('apiUrl is required for ClientToolTransport');
    super(options);
    this.setApiUrl(apiUrl);
  }

  /** @deprecated use apiUrl instead */
  get apiRoot() { return this.apiUrl; }
  /** @deprecated use apiUrl instead */
  set apiRoot(val) { this.apiUrl = val; }

  /**
   * Mounts the transport to a tools class, setting the default apiUrl for that class.
   * @param toolsClass - The tools class (e.g., ClientTools) to mount to.
   */
  public mount(toolsClass: any) {
    if (toolsClass && this.apiUrl) {
      toolsClass.apiUrl = this.apiUrl;
    }
  }

  public async loadApis(options?: any): Promise<Funcs> {
    const fetchOptions = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    return this.fetch('', undefined, 'get', undefined, fetchOptions);
  }

  async fetch(name: string, args?: any, act?: ActionName | string, subName?: any, fetchOptions?: any, toolTimeout?: any) {
    fetchOptions = { ...this.options, ...fetchOptions };

    // [Timeout Negotiation]
    // 1. User Override (from fetchOptions)
    let userTimeout = fetchOptions.timeout;
    if (typeof userTimeout === 'object' && userTimeout !== null) {
      userTimeout = userTimeout.value;
    }

    // 2. Tool Definition (from metadata)
    let defTimeout = toolTimeout;
    if (typeof defTimeout === 'object' && defTimeout !== null) {
      defTimeout = defTimeout.value;
    }

    // 3. Negotiate: min(user, tool) if both exist, else take whichever exists
    let finalTimeout: number | undefined;
    if (userTimeout !== undefined && defTimeout !== undefined) {
      finalTimeout = Math.min(Number(userTimeout), Number(defTimeout));
    } else if (userTimeout !== undefined) {
      finalTimeout = Number(userTimeout);
    } else if (defTimeout !== undefined) {
      finalTimeout = Number(defTimeout);
    }

    // [Stream Idle Timeout Negotiation]
    let userIdle = (typeof fetchOptions.timeout === 'object') ? fetchOptions.timeout.streamIdleTimeout : undefined;
    let defIdle = (typeof toolTimeout === 'object') ? toolTimeout.streamIdleTimeout : undefined;
    let finalIdleTimeout: number | undefined;

    if (userIdle !== undefined && defIdle !== undefined) {
      finalIdleTimeout = Math.min(Number(userIdle), Number(defIdle));
    } else if (userIdle !== undefined) {
      finalIdleTimeout = Number(userIdle);
    } else if (defIdle !== undefined) {
      finalIdleTimeout = Number(defIdle);
    }

    // 4. Apply back to fetchOptions & Headers
    if (finalTimeout !== undefined || finalIdleTimeout !== undefined) {
      // Ensure fetchOptions.timeout is updated (for client-side transport timeout logic)
      if (typeof fetchOptions.timeout !== 'object' || fetchOptions.timeout === null) {
        fetchOptions.timeout = { value: finalTimeout };
      } else {
        if (finalTimeout !== undefined) fetchOptions.timeout.value = finalTimeout;
      }

      if (finalIdleTimeout !== undefined) {
        fetchOptions.timeout.streamIdleTimeout = finalIdleTimeout;
      }

      // Propagate to Server via Headers
      if (!fetchOptions.headers) fetchOptions.headers = {};
      if (finalTimeout !== undefined) fetchOptions.headers[RPC_HEADERS.TIMEOUT] = String(finalTimeout);
    }

    // Also propagate expected-duration if available in fetchOptions
    if (fetchOptions.expectedDuration) {
      if (!fetchOptions.headers) fetchOptions.headers = {};
      fetchOptions.headers['rpc-expected-duration'] = String(fetchOptions.expectedDuration);
    }


    // 初始化请求专属 ID，确保任何超时后的拉取都能继续绑定到同一任务
    if (!fetchOptions.headers) fetchOptions.headers = {};
    const reqId = fetchOptions.headers[RPC_HEADERS.REQUEST_ID] || Date.now().toString(36) + Math.random().toString(36).substring(2);
    fetchOptions.headers[RPC_HEADERS.REQUEST_ID] = reqId;

    return this.executeWithPolling(name, args, act, subName, fetchOptions);
  }

  /**
   * 处理服务端通过 102 信号引发的客户端后台循环轮询逻辑
   */
  private async executeWithPolling(name: string, args: any, act: any, subName: any, fetchOptions: any): Promise<any> {
    const signal: AbortSignal = fetchOptions.signal;
    const reqId = fetchOptions.headers[RPC_HEADERS.REQUEST_ID];
    let abortListener: (() => void) | undefined;

    if (signal) {
      if (signal.aborted) {
        throw signal.reason || new Error('Aborted');
      }
      abortListener = () => {
        // 当本地信号触发时，尝试通知服务端注销后台任务 (Fire and forget)
        this.pollTaskStatus(reqId, { ...fetchOptions, act: '$cancel' }).catch(() => {});
      };
      signal.addEventListener('abort', abortListener);
    }

    try {
      let res = await this._fetch(name, args, act, subName, fetchOptions);

      // 监测到服务端正在执行硬超时退避，转入状态轮询重试
      while (res && res.status === 102) {
        // 读取 Retry-After 给出的参考轮询等待时间，避免洪水攻击 (支持标准与自定义头)
        const retryAfter = res.headers?.[RPC_HEADERS.RETRY_AFTER];
        const waitTime = retryAfter ? parseInt(String(retryAfter)) : RPC_DEFAULTS.RETRY_AFTER_MS;
        
        // 使用 Promise.race 允许在等待期间被信号中断
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, waitTime);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              reject(signal.reason || new Error('Aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });

        const pollRes = await this.pollTaskStatus(reqId, fetchOptions);
        res = pollRes;

        if (res && res.status === 102) {
          continue;
        }

        // Task is no longer 102! It must be completed or failed (which throws before this line).
        if (args?.stream) {
          return res; // directly return the fetch Response (stream)
        }
        return this.toObject(res, args);
      }

      // 对于正常结束的初始请求：
      if (args?.stream) {
        return res;
      }

      return this.toObject(res, args);
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
    }
  }

  /**
   * 模块化复用的轮询探查接口
   */
  public async pollTaskStatus(taskId: string, parentFetchOptions: any = {}): Promise<any> {
    const pollHeaders = { ...(parentFetchOptions.headers || {}) };
    delete pollHeaders[RPC_HEADERS.TIMEOUT];
    pollHeaders[RPC_HEADERS.TOOL_ID || RPC_HEADERS.FUNC] = 'rpcTask';
    pollHeaders[RPC_HEADERS.ACT] = parentFetchOptions.act || 'get';
    pollHeaders[RPC_HEADERS.RES_ID] = taskId;
    pollHeaders[RPC_HEADERS.REQUEST_ID] = 'poll-' + Date.now().toString(36) + Math.random().toString(36).substring(2);

    const pollOptions = {
      ...parentFetchOptions,
      headers: pollHeaders
    };

    return this._fetch('rpcTask', undefined, pollHeaders[RPC_HEADERS.ACT], taskId, pollOptions);
  }

  public abstract _fetch(name: string, args?: any, act?: ActionName | string, id?: any, fetchOptions?: any): any | Promise<any>;
  public abstract toObject(res: any, args?: any): any | Promise<any>;
}
