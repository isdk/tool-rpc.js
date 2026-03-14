import { Funcs } from "@isdk/tool-func";
import { ActionName } from '../consts';
import { IToolTransport, ToolTransport } from "./base";
import { RPC_HEADERS, RPC_DEFAULTS } from "./models";

export interface IClientToolTransport extends IToolTransport {
  loadApis(options?: any): Promise<Funcs>;
  fetch(name: string, args?: any, act?: ActionName | string, subName?: any, options?: any, toolTimeout?: any): any | Promise<any>;
  [name: string]: any;
}

export abstract class ClientToolTransport extends ToolTransport implements IClientToolTransport {
  declare apiUrl: string;

  constructor(apiUrl: string, options?: any) {
    if (!apiUrl) throw new Error('apiUrl is required for ClientToolTransport');
    super(options);
    this.setApiUrl(apiUrl);
  }

  /** @deprecated use apiUrl instead */
  get apiRoot() { return this.apiUrl; }
  /** @deprecated use apiUrl instead */
  set apiRoot(val) { this.apiUrl = val; }

  public async loadApis(options?: any): Promise<Funcs> {
    const fetchOptions = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    return this.fetch('', undefined, 'get', undefined, fetchOptions);
  }

  async fetch(name: string, args?: any, act?: ActionName | string, subName?: any, fetchOptions?: any, toolTimeout?: any) {
    fetchOptions = { ...this.options, ...fetchOptions };

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
    let res = await this._fetch(name, args, act, subName, fetchOptions);

    // 监测到服务端正在执行硬超时退避，转入状态轮询重试
    while (res && res.status === 102) {
      // 读取 Retry-After 给出的参考轮询等待时间，避免洪水攻击 (支持标准与自定义头)
      const retryAfter = res.headers?.[RPC_HEADERS.RETRY_AFTER];
      const waitTime = retryAfter ? parseInt(String(retryAfter)) : RPC_DEFAULTS.RETRY_AFTER_MS;
      await new Promise(r => setTimeout(r, waitTime));

      const reqId = fetchOptions.headers[RPC_HEADERS.REQUEST_ID];
      const pollRes = await this.pollTaskStatus(reqId, fetchOptions);

      if (pollRes && pollRes.status === 102) {
        res = pollRes; // Update res with new 102 response, respecting new retry-after
        continue;
      }

      // Task is no longer 102! It must be completed or failed (which throws before this line).
      if (args?.stream) {
        return pollRes; // directly return the fetch Response (stream)
      }
      return this.toObject(pollRes, args);
    }

    // 对于正常结束的初始请求：
    if (args?.stream) {
      return res;
    }

    return this.toObject(res, args);
  }

  /**
   * 模块化复用的轮询探查接口
   */
  public async pollTaskStatus(taskId: string, parentFetchOptions: any = {}): Promise<any> {
    const pollHeaders = { ...(parentFetchOptions.headers || {}) };
    delete pollHeaders[RPC_HEADERS.TIMEOUT];
    pollHeaders[RPC_HEADERS.TOOL_ID || RPC_HEADERS.FUNC] = 'rpcTask';
    pollHeaders[RPC_HEADERS.ACT] = 'get';
    pollHeaders[RPC_HEADERS.RES_ID] = taskId;
    pollHeaders[RPC_HEADERS.REQUEST_ID] = 'poll-' + Date.now().toString(36) + Math.random().toString(36).substring(2);

    const pollOptions = {
      ...parentFetchOptions,
      headers: pollHeaders
    };

    return this._fetch('rpcTask', undefined, 'get', taskId, pollOptions);
  }

  public abstract _fetch(name: string, args?: any, act?: ActionName | string, id?: any, fetchOptions?: any): any | Promise<any>;
  public abstract toObject(res: any, args?: any): any | Promise<any>;
}
