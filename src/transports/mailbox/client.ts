import { ClientTools } from '../../client-tools';
import { ClientToolTransport } from '../client';
import { Mailbox, MailMessage } from '@mboxlabs/mailbox';
import { ActionName } from '../../consts';
import { RemoteError } from './error';

/**
 * Configuration options for the MailboxClientTransport.
 */
export interface MailboxClientOptions {
  /**
   * The Mailbox instance to use for communication.
   * If not provided, a new Mailbox instance will be created.
   */
  mailbox?: Mailbox;
  /**
   * The server's physical address (gateway/RPC entry point).
   * E.g., 'mem://api@server/api'.
   */
  serverAddress?: string;
  /**
   * The root path for the API (logical placeholder). Default is '/'.
   * @deprecated Use serverAddress for the physical endpoint.
   */
  apiRoot?: string;
  /**
   * The client's own physical address to receive asynchronous responses.
   * This address must be unique and subscribable.
   */
  clientAddress?: string;
  /**
   * Request timeout in milliseconds. Default is 30000 (30 seconds).
   */
  timeout?: number;
  /**
   * Additional transport-specific options.
   */
  [key: string]: any;
}

/**
 * Represents a pending asynchronous request waiting for a mailbox response.
 * @internal
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
}

/**
 * A client-side transport implementation using @mboxlabs/mailbox.
 *
 * This transport enables making remote procedure calls over an asynchronous
 * message-based architecture. It manages a local registry of pending requests,
 * each associated with a unique 'mbx-req-id' to handle asynchronous correlation.
 */
export class MailboxClientTransport extends ClientToolTransport {
  protected mailbox: Mailbox;
  protected serverAddress: string;
  protected clientAddress: string;
  protected pendingRequests: Map<string, PendingRequest> = new Map();
  protected subscription: any;
  protected timeout: number;
  protected isInternalMailbox = false;

  constructor(options: MailboxClientOptions) {
    const serverAddress = options.serverAddress || options.apiRoot;
    if (!serverAddress) {
      throw new Error('serverAddress (physical server address) is required for MailboxClientTransport');
    }
    if (!options.clientAddress) {
      throw new Error('clientAddress is required for MailboxClientTransport to receive responses');
    }
    super(options.apiRoot || '/');
    if (options.mailbox) {
      this.mailbox = options.mailbox;
    } else {
      this.mailbox = new Mailbox();
      this.isInternalMailbox = true;
    }
    this.serverAddress = serverAddress;
    this.clientAddress = options.clientAddress;
    this.timeout = options.timeout || 30000;
    this.options = options;
  }

  async _mount(clientTools: typeof ClientTools, apiPrefix: string, options?: any) {
    await this.mailbox.start?.();
    if (!this.subscription) {
      this.subscription = this.mailbox.subscribe(this.clientAddress, this.onResponse.bind(this));
    }
    return super._mount(clientTools, apiPrefix, options);
  }

  protected onResponse(message: MailMessage) {
    const { body, headers } = message;
    const reqId = headers?.['mbx-req-id'];

    if (reqId && this.pendingRequests.has(reqId)) {
      const { resolve, reject, timer } = this.pendingRequests.get(reqId)!;
      clearTimeout(timer);
      this.pendingRequests.delete(reqId);

      if (body && typeof body === 'object' && 'error' in body) {
        reject(RemoteError.fromJSON(body));
      } else {
        resolve(body);
      }
    } else if (reqId) {
      console.warn(`[MailboxClientTransport] Received response for unknown or timed-out request ID: ${reqId}`);
    }
  }

  async loadApis(): Promise<any> {
    return this.fetch('', {}, 'list');
  }

  public async _fetch(fnId: string, args?: any, act?: ActionName | string, resId?: any, fetchOptions?: any): Promise<any> {
    const reqId = crypto.randomUUID();
    const targetAddressStr = this.serverAddress;

    if (!act) {
      act = (this.Tools as any)?.action || 'post';
    }
    if (act === 'res') {
      act = 'get';
    }

    const messageBody = { ...(args || {}) };
    const messageHeaders: any = {
      'mbx-req-id': reqId,
      'mbx-reply-to': this.clientAddress,
      'mbx-fn-id': fnId || undefined,
      'mbx-act': act || undefined,
      ...fetchOptions?.headers,
    };

    if (resId !== undefined && resId !== null) {
      messageHeaders['mbx-res-id'] = typeof resId === 'string' ? resId : JSON.stringify(resId);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`Request timeout after ${this.timeout}ms`));
        }
      }, this.timeout);

      this.pendingRequests.set(reqId, { resolve, reject, timer });

      this.mailbox.post({
        from: this.clientAddress,
        to: targetAddressStr,
        body: messageBody,
        headers: messageHeaders
      }).catch(err => {
        clearTimeout(timer);
        this.pendingRequests.delete(reqId);
        reject(err);
      });
    });
  }

  async toObject(res: any) {
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
