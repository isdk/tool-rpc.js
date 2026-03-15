import { ServerToolTransport } from './server';
import { Mailbox, MailMessage } from '@mboxlabs/mailbox';
import { ToolRpcRequest, ToolRpcResponse, RPC_HEADERS, RpcStatusCode } from './models';

export interface MailboxServerOptions {
  mailbox?: Mailbox;
  apiUrl?: string;
  /** @deprecated use apiUrl instead */
  address?: string;
  mode?: 'push' | 'pull';
  pullInterval?: number;
  [key: string]: any;
}

export class MailboxServerTransport extends ServerToolTransport {
  protected mailbox: Mailbox;
  protected listenAddress: string = '';
  protected apiPrefix: string = '/';
  protected discoveryHandlerInfo: { prefix: string; handler: () => any } | null = null;
  protected subscription: any;
  protected mode: 'push' | 'pull' = 'push';
  protected pullInterval: number = 1000;
  protected isRunning: boolean = false;
  protected isInternalMailbox = false;

  constructor(options: MailboxServerOptions = {}) {
    super(options);
    if (options.mailbox) {
      this.mailbox = options.mailbox;
    } else {
      this.mailbox = new Mailbox();
      this.isInternalMailbox = true;
    }

    const apiUrl = options.apiUrl || options.address;
    if (!apiUrl) {
      throw new Error('MailboxServerTransport: apiUrl is required');
    }
    this.apiUrl = apiUrl;
    this.listenAddress = apiUrl;
    this.apiPrefix = this.extractPath(apiUrl);

    this.mode = options.mode || 'push';
    this.pullInterval = options.pullInterval || 1000;
    this.options = options;
  }

  protected extractPath(urlStr: string): string {
    try {
      const url = new URL(urlStr);
      let p = url.pathname.replace(/\/+/g, '/'); // 压缩连续斜杠
      if (!p.startsWith('/')) p = '/' + p;
      if (!p.endsWith('/')) p += '/';
      return p;
    } catch (e) {
      return '/';
    }
  }

  public addDiscoveryHandler(apiUrl: string, handler: () => any): void {
    const prefix = this.extractPath(apiUrl);
    this.discoveryHandlerInfo = { prefix, handler };
  }

  public addRpcHandler(apiUrl: string, options?: any) {
    this.apiPrefix = this.extractPath(apiUrl);
  }

  protected async onReceive(message: MailMessage) {
    const { headers } = message;
    const toolId = headers?.[RPC_HEADERS.TOOL_ID];
    const act = headers?.[RPC_HEADERS.ACT];

    // 处理内置发现逻辑 (Discovery)
    if (!toolId && this.discoveryHandlerInfo && (act === 'list' || act === 'get')) {
      try {
        let result = await this.discoveryHandlerInfo.handler();
        if (typeof result?.toJSON === 'function') {
          result = result.toJSON();
        }
        await this.sendRpcResponse({ status: RpcStatusCode.OK, data: result }, message);
      } catch (err: any) {
        await this.sendRpcResponse({
          status: RpcStatusCode.INTERNAL_ERROR,
          error: { message: err.message, code: err.code || 500, status: 'error' }
        }, message);
      }
      return;
    }

    await this.processIncomingCall(message, message);
  }

  protected async toRpcRequest(rawReq: MailMessage): Promise<ToolRpcRequest> {
    const { body, headers, id: msgId } = rawReq;

    // 强制转换为字符串记录 headers，并合并 V1 到 V2 头信息
    const rpcHeaders: Record<string, string> = {};
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        rpcHeaders[k] = Array.isArray(v) ? v.join(',') : String(v);
      }
    }

    const getAddr = (addr: any) => typeof addr === 'string' ? addr : addr?.href;
    const fromStr = getAddr(rawReq.from);
    const toStr = getAddr(rawReq.to);

    // 注入虚拟 Mailbox 追踪头信息
    if (fromStr) rpcHeaders['x-mailbox-from'] = fromStr;
    if (toStr) rpcHeaders['x-mailbox-to'] = toStr;
    if (msgId) rpcHeaders['x-mailbox-msg-id'] = String(msgId);

    // 标准化路由控制头映射
    const toolId = rpcHeaders[RPC_HEADERS.TOOL_ID];
    const act = rpcHeaders[RPC_HEADERS.ACT];
    const resId = rpcHeaders[RPC_HEADERS.RES_ID];
    const traceId = rpcHeaders[RPC_HEADERS.TRACE_ID];
    const reqId = rpcHeaders[RPC_HEADERS.REQUEST_ID] || (this.options.strict === false ? msgId : undefined);

    if (!toolId) {
      throw { status: RpcStatusCode.BAD_REQUEST, message: `Invalid request to ${toStr}: missing tool identifier (rpc-fn)` };
    }

    if (!reqId) {
      throw { status: RpcStatusCode.BAD_REQUEST, message: `Invalid request to ${toStr}: missing ${RPC_HEADERS.REQUEST_ID} in headers (Strict Mode)` };
    }

    return {
      apiUrl: this.apiUrl, // 始终返回归一化的 Transport apiUrl
      toolId: toolId as string,
      act: act as string,
      resId: resId as string,
      traceId: traceId as string,
      requestId: reqId as string,
      params: body || {},
      headers: rpcHeaders,
      raw: rawReq
    };
  }

  protected async sendRpcResponse(rpcRes: ToolRpcResponse, rawRes: MailMessage): Promise<void> {
    let resultBody: any;
    if (rpcRes.status === RpcStatusCode.PROCESSING) {
      resultBody = rpcRes.data || { status: RpcStatusCode.PROCESSING, headers: rpcRes.headers };
    } else if (rpcRes.error) {
      resultBody = {
        error: {
          message: rpcRes.error.message,
          code: rpcRes.error.code || rpcRes.status,
          status: rpcRes.error.status || (rpcRes.status === 404 ? 'not_found' : 'error'),
          data: rpcRes.error.data,
        }
      };
    } else {
      resultBody = rpcRes.data;
    }

    const reqId = rawRes.headers?.[RPC_HEADERS.REQUEST_ID] || rawRes.id;

    const getAddr = (addr: any) => typeof addr === 'string' ? addr : addr?.href;
    const replyTo = rawRes.headers?.['mbx-reply-to'] || getAddr(rawRes.from);
    const fromAddr = this.listenAddress || getAddr(rawRes.to);

    await this.mailbox.post({
      from: fromAddr,
      to: replyTo,
      body: resultBody,
      headers: {
        [RPC_HEADERS.REQUEST_ID]: reqId,
        'content-type': 'application/json',
      }
    });
  }

  public async _start(options?: any): Promise<void> {
    const address = options?.address || this.listenAddress;
    if (!address) { throw new Error('MailboxServerTransport: address is required to start'); }

    if (this.isRunning) { await this.stop(); }
    this.isRunning = true;

    await this.mailbox.start?.();

    if (this.mode === 'push') {
      this.subscription = this.mailbox.subscribe(address, this.onReceive.bind(this));
      await this.drainBacklog(address);
    } else {
      this.runPullLoop(address);
    }
  }

  protected async drainBacklog(address: string) {
    let message;
    while (this.isRunning && (message = await this.mailbox.fetch(address, { manualAck: true }))) {
      await this.onReceive(message);
      if ('ack' in message && typeof message.ack === 'function') {
        await message.ack();
      }
    }
  }

  protected async runPullLoop(address: string) {
    while (this.isRunning) {
      try {
        const message = await this.mailbox.fetch(address, { manualAck: true });
        if (message) {
          await this.onReceive(message);
          if ('ack' in message && typeof message.ack === 'function') {
            await message.ack();
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, this.pullInterval));
        }
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, this.pullInterval));
      }
    }
  }

  public async stop(force?: boolean): Promise<void> {
    this.isRunning = false;
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.isInternalMailbox) {
      await this.mailbox.stop?.();
    }
  }

  public getRaw(): Mailbox { return this.mailbox; }
}
