import { ServerTools } from '../../server-tools';
import { ServerToolTransport } from '../server';
import { Mailbox, MailMessage } from '@mboxlabs/mailbox';

/**
 * Configuration options for the MailboxServerTransport.
 */
export interface MailboxServerOptions {
  /**
   * The Mailbox instance to use for communication.
   * If not provided, a new Mailbox instance will be created.
   */
  mailbox?: Mailbox;
  /**
   * The unique physical address this server listens on (e.g., 'mem://api@server/api').
   * This address is used for mailbox subscription or fetching.
   */
  address?: string;
  /**
   * The root path for the API. Default is '/'.
   */
  apiRoot?: string;
  /**
   * Transport mode: 'push' (subscribe) or 'pull' (fetch). Default is 'push'.
   */
  mode?: 'push' | 'pull';
  /**
   * Fetch interval in milliseconds for 'pull' mode. Default is 1000ms.
   */
  pullInterval?: number;
  /**
   * Additional transport-specific options.
   */
  [key: string]: any;
}

/**
 * A server-side transport implementation using @mboxlabs/mailbox.
 */
export class MailboxServerTransport extends ServerToolTransport {
  protected mailbox: Mailbox;
  protected listenAddress?: string;
  protected discoveryHandlerInfo: { prefix: string; handler: () => any } | null = null;
  protected subscription: any;
  protected mode: 'push' | 'pull' = 'push';
  protected pullInterval: number = 1000;
  protected isRunning: boolean = false;
  protected isInternalMailbox = false;

  constructor(options: MailboxServerOptions = {}) {
    super();
    if (options.mailbox) {
      this.mailbox = options.mailbox;
    } else {
      this.mailbox = new Mailbox();
      this.isInternalMailbox = true;
    }
    if (options.address) {
      this.listenAddress = options.address;
    }
    this.apiRoot = options.apiRoot || '/';
    this.mode = options.mode || 'push';
    this.pullInterval = options.pullInterval || 1000;
    this.options = options;
  }

  public addDiscoveryHandler(apiPrefix: string, handler: () => any): void {
    this.discoveryHandlerInfo = { prefix: apiPrefix, handler };
  }

  public addRpcHandler(serverTools: typeof ServerTools, apiPrefix: string, options?: any) {
    if (apiPrefix && !apiPrefix.endsWith('/')) {
      apiPrefix += '/';
    }
    this.apiRoot = apiPrefix;
  }

  protected async onReceive(message: MailMessage) {
    const { to, body, headers, id: msgId } = message;
    const reqId = headers?.['mbx-req-id'] || msgId;
    const replyTo = headers?.['mbx-reply-to'] || message.from.href;
    const fromAddr = this.listenAddress || to.href;

    try {
      let result: any;
      const fnId = headers?.['mbx-fn-id'] || undefined;
      const resId = headers?.['mbx-res-id'] || undefined;
      const act = headers?.['mbx-act'] || undefined;

      if (!fnId && this.discoveryHandlerInfo && (act === 'list' || act === 'get')) {
        result = this.discoveryHandlerInfo.handler();
        if (typeof result?.toJSON === 'function') {
          result = result.toJSON();
        }
      } else if (fnId) {
        const func: any = this.Tools.get(fnId);
        if (!func) {
          const err: any = new Error(`Tool ${fnId} not found`);
          err.code = 404;
          err.data = { what: fnId };
          throw err;
        }

        const params = { ...(body || {}), _req: message };
        if (resId) { params.id = resId; }
        if (act) { params.act = act; }

        result = await func.run(params);
      } else {
        const err: any = new Error(`Invalid request to ${to.href}: missing 'mbx-fn-id' in headers`);
        err.code = 400;
        throw err;
      }

      await this.mailbox.post({
        from: fromAddr,
        to: replyTo,
        body: result,
        headers: { 'mbx-req-id': reqId }
      });
    } catch (error: any) {
      console.error('[MailboxServerTransport] Error processing message:', error);
      const errorBody = {
        error: error.message || 'Internal Server Error',
        code: error.code || 500,
        data: error.data || { what: error.name }
      };
      
      await this.mailbox.post({
        from: fromAddr,
        to: replyTo,
        body: errorBody,
        headers: { 'mbx-req-id': reqId }
      }).catch(err => console.error('[MailboxServerTransport] Critical: Failed to send error response:', err));
    }
  }

  public async _start(options?: any): Promise<void> {
    const address = options?.address || this.listenAddress;
    if (!address) { throw new Error('MailboxServerTransport: address is required to start'); }
    
    if (this.isRunning) { await this.stop(); }
    this.isRunning = true;

    await this.mailbox.start?.();

    if (this.mode === 'push') {
      // Subscribe first to capture new incoming messages
      this.subscription = this.mailbox.subscribe(address, this.onReceive.bind(this));
      // Then drain backlog to process existing messages
      await this.drainBacklog(address);
    } else {
      // Pull mode naturally drains backlog first
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

  public async stop(): Promise<void> {
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
