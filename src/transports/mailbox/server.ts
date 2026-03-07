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
   * This address is used for mailbox subscription.
   */
  address?: string;
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
 * and routes them to the appropriate tool based on the message body or URL pathname.
 *
 * @example
 * ```typescript
 * const transport = new MailboxServerTransport({
 *   address: 'mem://api@server/api',
 *   mailbox: myMailbox
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
    this.apiRoot = apiPrefix;
  }

  /**
   * Internal handler for incoming MailMessages.
   * Performs tool routing, execution, and sends the response back to the sender.
   *
   * @param message - The incoming mail message containing the request.
   * @protected
   */
  protected async onReceive(message: MailMessage) {
    const { from, to, body, headers, id: msgId } = message;
    const reqId = headers?.['mbx-req-id'] || msgId;

    try {
      let result: any;
      const pathname = to.pathname.replace(/\/$/, '');
      let apiPrefix = this.apiRoot ? this.apiRoot.replace(/\/$/, '') : '';

      // Routing logic: body.name takes precedence over URL pathname
      let toolId = body.name || '';
      let id = body.subName || body.id || '';
      let act = body.act || '';

      if (!toolId && pathname.startsWith(apiPrefix)) {
        const urlPath = pathname.substring(apiPrefix.length).replace(/^\//, '');
        const parts = urlPath.split('/').map(s => s ? decodeURIComponent(s) : s);
        toolId = parts[0];
        if (!id && parts.length > 1) {
          id = parts[1];
        }
      }

      if (!toolId && this.discoveryHandlerInfo && (act === 'list' || act === 'get')) {
        // Handle Discovery request
        result = this.discoveryHandlerInfo.handler().toJSON();
      } else if (toolId) {
        // Handle RPC request
        const func: any = this.Tools.get(toolId);
        if (!func) {
          throw new Error(`Tool ${toolId} not found`);
        }

        // Inject MailMessage as transport context (_req)
        const params = { ...body, _req: message };
        if (id) {
          params.id = id;
        }
        if (act) {
          params.act = act;
        }

        result = await func.run(params);
      } else {
        throw new Error(`Invalid request to ${to.href}`);
      }

      // Send response back to the sender's address
      await this.mailbox.post({
        from: to.href,
        to: from.href,
        body: result,
        headers: {
          'mbx-req-id': reqId,
          'mbx-res-to': msgId,
        }
      });
    } catch (error: any) {
      console.error('[MailboxServerTransport] Error processing message:', error);
      await this.mailbox.post({
        from: to.href,
        to: from.href,
        body: { error: error.message || 'Internal Server Error', code: error.code || 500 },
        headers: {
          'mbx-req-id': reqId,
          'mbx-res-to': msgId,
        }
      });
    }
  }

  /**
   * Starts the transport by subscribing to the configured address.
   * @param options - Optional override for the listening address.
   * @returns A promise that resolves when the subscription is active.
   */
  public async _start(options?: any): Promise<void> {
    const address = options?.address || this.listenAddress;
    if (!address) {
      throw new Error('MailboxServerTransport: address is required to start');
    }
    this.subscription = this.mailbox.subscribe(address, this.onReceive.bind(this));
    console.log(`[MailboxServerTransport] Listening on ${address}`);
  }

  /**
   * Stops the transport and unsubscribes from the mailbox.
   * @returns A promise that resolves when the transport is stopped.
   */
  public async stop(): Promise<void> {
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
