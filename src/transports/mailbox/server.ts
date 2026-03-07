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
 *
 * This transport enables exposing ServerTools over an asynchronous, message-based
 * architecture (Actor model). It listens for MailMessages on a specific address
 * and routes them to the appropriate tool based on headers, URL pathname, or message body.
 *
 * @example
 * ```typescript
 * const transport = new MailboxServerTransport({
 *   address: 'mem://api@server/api',
 *   mailbox: myMailbox,
 *   mode: 'push'
 * });
 * transport.mount(ServerTools, '/api');
 * await transport.start();
 * ```
 */
export class MailboxServerTransport extends ServerToolTransport {
  protected mailbox: Mailbox;
  protected listenAddress?: string;
  protected discoveryHandlerInfo: { prefix: string; handler: () => any } | null = null;
  protected subscription: any;
  protected mode: 'push' | 'pull' = 'push';
  protected pullInterval: number = 1000;
  protected isRunning: boolean = false;

  /**
   * Creates an instance of MailboxServerTransport.
   * @param options - Configuration options for the transport.
   */
  constructor(options: MailboxServerOptions = {}) {
    super();
    this.mailbox = options.mailbox || new Mailbox();
    if (options.address) {
      this.listenAddress = options.address;
    }
    this.apiRoot = options.apiRoot || '/';
    this.mode = options.mode || 'push';
    this.pullInterval = options.pullInterval || 1000;
    this.options = options;
  }

  /**
   * Registers a handler for the tool discovery endpoint.
   * @param apiPrefix - The path prefix for the discovery endpoint.
   * @param handler - A function that returns the tool definitions.
   */
  public addDiscoveryHandler(apiPrefix: string, handler: () => any): void {
    this.discoveryHandlerInfo = { prefix: apiPrefix, handler };
  }

  /**
   * Configures the RPC handler for the given server tools and prefix.
   * @param serverTools - The ServerTools registry.
   * @param apiPrefix - The root path prefix for RPC calls.
   * @param options - Additional options for the RPC handler.
   */
  public addRpcHandler(serverTools: typeof ServerTools, apiPrefix: string, options?: any) {
    if (apiPrefix && !apiPrefix.endsWith('/')) {
      apiPrefix += '/';
    }
    this.apiRoot = apiPrefix;
  }

  /**
   * Internal handler for incoming MailMessages.
   * Performs tool routing, execution, and sends the response back to the sender or reply-to address.
   *
   * @param message - The incoming mail message containing the request.
   * @protected
   */
  protected async onReceive(message: MailMessage) {
    const { to, body, headers, id: msgId } = message;
    const reqId = headers?.['mbx-req-id'] || msgId;
    const replyTo = headers?.['mbx-reply-to'] || message.from.href;

    try {
      let result: any;
      
      // Routing logic: Headers are the single source of truth (mbx-fn-id, mbx-res-id, mbx-act)
      const fnId = headers?.['mbx-fn-id'] || '';
      const resId = headers?.['mbx-res-id'] || '';
      const act = headers?.['mbx-act'] || '';

      if (!fnId && this.discoveryHandlerInfo && (act === 'list' || act === 'get')) {
        // Handle Discovery request
        result = this.discoveryHandlerInfo.handler();
        if (typeof result?.toJSON === 'function') {
          result = result.toJSON();
        }
      } else if (fnId) {
        // Handle RPC request
        const func: any = this.Tools.get(fnId);
        if (!func) {
          const err: any = new Error(`Tool ${fnId} not found`);
          err.code = 404;
          err.data = { what: fnId };
          throw err;
        }

        // Inject MailMessage as transport context (_req)
        const params = { ...(body || {}), _req: message };
        if (resId) {
          params.id = resId;
        }
        if (act) {
          params.act = act;
        }

        result = await func.run(params);
      } else {
        const err: any = new Error(`Invalid request to ${to.href}: missing 'mbx-fn-id' in headers`);
        err.code = 400;
        throw err;
      }

      // Send response back
      const fromAddr = this.listenAddress || to.href;
      await this.mailbox.post({
        from: fromAddr,
        to: replyTo,
        body: result,
        headers: {
          'mbx-req-id': reqId,
        }
      });
    } catch (error: any) {
      console.error('[MailboxServerTransport] Error processing message:', error);
      const errorBody = {
        error: error.message || 'Internal Server Error',
        code: error.code || 500,
        data: error.data || { what: error.name }
      };
      
      await this.mailbox.post({
        from: to.href,
        to: replyTo,
        body: errorBody,
        headers: {
          'mbx-req-id': reqId,
        }
      }).catch(err => console.error('[MailboxServerTransport] Critical: Failed to send error response:', err));
    }
  }

  /**
   * Starts the transport by subscribing or starting a fetch loop.
   * @param options - Optional override for the listening address.
   * @returns A promise that resolves when the transport is active.
   */
  public async _start(options?: any): Promise<void> {
    const address = options?.address || this.listenAddress;
    if (!address) {
      throw new Error('MailboxServerTransport: address is required to start');
    }
    
    if (this.isRunning) {
      await this.stop();
    }
    
    this.isRunning = true;

    // Fundamental Mailbox behavior: drain backlog first
    await this.drainBacklog(address);

    if (this.mode === 'push') {
      this.subscription = this.mailbox.subscribe(address, this.onReceive.bind(this));
    } else {
      this.runPullLoop(address);
    }
  }

  /**
   * Drains any existing messages in the mailbox.
   * @param address - The address to drain.
   * @protected
   */
  protected async drainBacklog(address: string) {
    let message;
    while (this.isRunning && (message = await this.mailbox.fetch(address, { manualAck: true }))) {
      await this.onReceive(message);
      if ('ack' in message && typeof message.ack === 'function') {
        await message.ack();
      }
    }
  }

  /**
   * Internal loop for 'pull' mode.
   * @param address - The address to fetch from.
   * @protected
   */
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
          // No message, wait for next interval
          await new Promise(resolve => setTimeout(resolve, this.pullInterval));
        }
      } catch (error) {
        // Silently retry on loop error after interval
        await new Promise(resolve => setTimeout(resolve, this.pullInterval));
      }
    }
  }

  /**
   * Stops the transport and unsubscribes or breaks the pull loop.
   * @returns A promise that resolves when the transport is stopped.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Returns the underlying Mailbox instance.
   * @returns The Mailbox instance.
   */
  public getRaw(): Mailbox {
    return this.mailbox;
  }
}
