import { ClientToolTransport, ClientToolTransportOptions } from "./client";
import { ActionName } from "../consts";
import { RPC_HEADERS } from "./models";
import { Mailbox, MailMessage } from '@mboxlabs/mailbox';
import { uuidv4 } from '@isdk/hash';

export interface MailboxClientTransportOptions extends ClientToolTransportOptions {
  mailbox?: Mailbox;
  /** @deprecated use apiUrl instead */
  serverAddress?: string;
  clientAddress?: string;
  timeout?: number | {
    value: number;
    streamIdleTimeout?: number;
    keepAliveOnTimeout?: boolean;
  };
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
}

export class MailboxClientTransport extends ClientToolTransport {
  protected mailbox!: Mailbox;
  protected serverAddress: string;
  protected clientAddress: string;
  protected pendingRequests: Map<string, PendingRequest> = new Map();
  protected subscription: any;
  protected timeout: any;
  protected isInternalMailbox = false;

  constructor(options: MailboxClientTransportOptions) {
    const apiUrl = options.apiUrl || options.serverAddress || (options as any).apiRoot;
    if (!apiUrl) {
      throw new Error('apiUrl (serverAddress) is required for MailboxClientTransport');
    }
    if (!options.clientAddress) {
      throw new Error('clientAddress is required for MailboxClientTransport to receive responses');
    }
    super(apiUrl, options);
    if (options.mailbox) {
      this.mailbox = options.mailbox;
    } else {
      this.mailbox = new Mailbox();
      this.isInternalMailbox = true;
    }
    this.serverAddress = apiUrl;
    this.clientAddress = options.clientAddress;
    this.timeout = options.timeout || 30000;
  }

  public async start(): Promise<void> {
    await this.mailbox.start?.();
    if (!this.subscription) {
      this.subscription = this.mailbox.subscribe(this.clientAddress, this.onResponse.bind(this));
    }
  }

  protected onResponse(message: MailMessage) {
    const { body, headers } = message;
    // 关联 id 的字段名只从 RPC_HEADERS 取：写字面量时它与 REQUEST_ID 恰好同值，
    // 但协议一旦改名就会错开（服务端回显的是 RPC_HEADERS.REQUEST_ID）
    const reqId = headers?.[RPC_HEADERS.REQUEST_ID];

    if (reqId && this.pendingRequests.has(reqId)) {
      const { resolve, reject, timer } = this.pendingRequests.get(reqId)!;
      clearTimeout(timer);
      this.pendingRequests.delete(reqId);

      // Support V2 Protocol Status object
      if (body && typeof body === 'object') {
        const isProcessing = body.status === 102 || body.error?.code === 102;
        if (isProcessing) {
          resolve(body);
          return;
        }
        if (body.error) {
          const err: any = new Error(body.error.message || (typeof body.error === 'string' ? body.error : 'Unknown Error'));
          err.code = body.error.code || body.code || 500;
          err.status = body.error.status || 'error';
          err.data = body.error.data;
          if (body.error.name) err.name = body.error.name;
          reject(err);
          return;
        }
      }

      resolve(body);
    }
  }

  /** 构造时声明的默认超时（可以是数字，也可以是 `{ value }` 对象）。 */
  protected timeoutValue(): number {
    const declared: any = this.timeout;
    const value = (declared && typeof declared === 'object') ? declared.value : declared;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 30000;
  }

  public async _fetch(name: string, args?: any, act?: ActionName | string, id?: any, fetchOptions?: any) {
    const reqId = fetchOptions?.headers?.[RPC_HEADERS.REQUEST_ID] || uuidv4();
    const targetAddressStr = this.serverAddress;

    const messageHeaders: any = {
      [RPC_HEADERS.REQUEST_ID]: reqId,
      'mbx-reply-to': this.clientAddress,
      ...fetchOptions?.headers,
    };

    if (name) messageHeaders[RPC_HEADERS.FUNC] = name;
    if (act) messageHeaders[RPC_HEADERS.ACT] = act;
    if (id) messageHeaders[RPC_HEADERS.RES_ID] = id;

    // 超时优先级：本次请求的 fetchOptions.timeout > 构造时的 options.timeout。
    // 以前 `this.timeout` 存下来却从不读，`new MailboxClientTransport({ timeout: 500 })`
    // 完全无效（实测本地定时器仍是 30200ms）
    let timeoutVal: number = this.timeoutValue();
    if (fetchOptions?.timeout) {
      timeoutVal = typeof fetchOptions.timeout === 'number' ? fetchOptions.timeout : fetchOptions.timeout.value;
      messageHeaders[RPC_HEADERS.TIMEOUT] = String(timeoutVal);
    }

    const clientLocalTimeout = timeoutVal + 200;
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        if (this.pendingRequests.has(reqId)) {
          clearTimeout(timer);
          this.pendingRequests.delete(reqId);
          const err: any = new Error('The operation was aborted');
          err.name = 'AbortError';
          err.code = 20;
          reject(err);
        }
      };

      if (fetchOptions?.signal?.aborted) {
        return abortHandler();
      }

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          const err: any = new Error(`Request timeout after ${clientLocalTimeout}ms`);
          err.code = 504;
          reject(err);
        }
      }, clientLocalTimeout);

      if (fetchOptions?.signal) {
        fetchOptions.signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.pendingRequests.set(reqId, { resolve, reject, timer });

      this.mailbox.post({
        from: this.clientAddress,
        to: targetAddressStr,
        body: args,
        headers: messageHeaders
      }).catch(err => {
        clearTimeout(timer);
        this.pendingRequests.delete(reqId);
        reject(err);
      });
    });
  }

  public async toObject(res: any, args?: any): Promise<any> {
    if (res && res.status === 102) return res;
    return res;
  }

  public async stop(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
    for (const { reject, timer } of this.pendingRequests.values()) {
      clearTimeout(timer);
      reject(new Error('Transport stopped'));
    }
    this.pendingRequests.clear();
    if (this.isInternalMailbox) {
      await this.mailbox.stop?.();
    }
  }
}
