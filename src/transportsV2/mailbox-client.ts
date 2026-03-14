import { ClientToolTransport } from "./client";
import { ActionName } from "../consts";
import { RPC_HEADERS } from "./models";
import { Mailbox, MailMessage } from '@mboxlabs/mailbox';

export interface MailboxClientOptions {
  mailbox?: Mailbox;
  apiUrl?: string;
  /** @deprecated use apiUrl instead */
  serverAddress?: string;
  clientAddress?: string;
  timeout?: number | {
    value: number;
    streamIdleTimeout?: number;
    keepAliveOnTimeout?: boolean;
  };
  [key: string]: any;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
}

export class MailboxClientTransport extends ClientToolTransport {
  protected mailbox: Mailbox;
  protected serverAddress: string;
  protected clientAddress: string;
  protected pendingRequests: Map<string, PendingRequest> = new Map();
  protected subscription: any;
  protected timeout: any;
  protected isInternalMailbox = false;

  constructor(options: MailboxClientOptions) {
    const apiUrl = options.apiUrl || options.serverAddress || options.apiRoot;
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
    const reqId = headers?.['x-rpc-request-id'] || headers?.['mbx-req-id'];

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

  public async _fetch(name: string, args?: any, act?: ActionName | string, id?: any, fetchOptions?: any) {
    const reqId = fetchOptions?.headers?.['x-rpc-request-id'] || crypto.randomUUID();
    const targetAddressStr = this.serverAddress;

    const messageHeaders: any = {
      'x-rpc-request-id': reqId,
      'mbx-reply-to': this.clientAddress,
      ...fetchOptions?.headers,
    };

    if (name) messageHeaders[RPC_HEADERS.FUNC] = name;
    if (act) messageHeaders[RPC_HEADERS.ACT] = act;
    if (id) messageHeaders[RPC_HEADERS.RES_ID] = id;

    let timeoutVal: number = 30000;
    if (fetchOptions?.timeout) {
      timeoutVal = typeof fetchOptions.timeout === 'number' ? fetchOptions.timeout : fetchOptions.timeout.value;
      messageHeaders[RPC_HEADERS.TIMEOUT] = timeoutVal.toString();
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
