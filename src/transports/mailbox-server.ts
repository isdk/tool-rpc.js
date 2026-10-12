import { RouteClaimOptions, ServerToolTransport, ServerToolTransportOptions } from './server';
import { Mailbox, MailMessage } from '@mboxlabs/mailbox';
import { ToolRpcRequest, ToolRpcResponse, RPC_HEADERS, RpcStatusCode, RpcError } from './models';

export interface MailboxServerTransportOptions extends ServerToolTransportOptions {
  mailbox?: Mailbox;
  /** @deprecated use apiUrl instead */
  address?: string;
  mode?: 'push' | 'pull';
  pullInterval?: number;
}

export class MailboxServerTransport extends ServerToolTransport {
  protected mailbox!: Mailbox;
  protected listenAddress: string = '';
  /** 轮询循环只报一次错：服务端挂掉与「没有消息」在外部完全一样，不能静默吞。 */
  protected pullLoopErrored = false;
  protected subscription: any;
  protected mode: 'push' | 'pull' = 'push';
  protected pullInterval: number = 1000;
  protected isRunning: boolean = false;
  protected isInternalMailbox = false;

  constructor(options: MailboxServerTransportOptions = {}) {
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

    this.mode = options.mode || 'push';
    this.pullInterval = options.pullInterval || 1000;
  }

  /**
   * 路由前缀的归一化不另写一份：基类的 `toPathname`（route-path.ts 的
   * `normalizeRoutePath`）已经处理了「完整 URL 取 path」与「裸 path 前缀」两种写法。
   *
   * 以前这里自己写一套 `extractPath`（`new URL` 失败就退回 '/'），于是裸前缀声明
   * 全塌成 '/'：`addRpcHandler('/y')` 后再 `addRpcHandler('/z')` 会被当成重复声明
   * 拒掉（实测），与基类「声明侧与请求侧同一套规则」的不变量直接矛盾。
   */

  /**
   * Mailbox 默认接管全量路径：这是设计文档规定的独占保护（同一 mailbox 地址
   * 只允许一个服务端实例），不能因为声明了具体前缀就缩小成该前缀。
   */
  public getRoutes(): string[] {
    return ['/'];
  }

  /**
   * @deprecated 发现端点已由内置工具 `rpcApis` 接管（与 HTTP 侧同一结论）；只有要自定义
   * 该地址列什么时才需要它。迁移提示进程级只打一次（`warnDiscoveryDeprecated`）。
   */
  public addDiscoveryHandler(apiUrl: string, handler: () => any, options?: RouteClaimOptions): void {
    this.warnDiscoveryDeprecated();
    // mailbox 按地址路由而非按路径路由，所以只有一份清单内容；它登记在 claim 上，
    // 请求期由 `requestRegistry` 把它当成该前缀的 `rpcApis` 实现（与 HTTP 同一条路径）。
    // 重复声明的处理（替换 + 告警 / 抛错）与 remount 选项仍由基类统一裁决。
    this.claimRoute(apiUrl, 'discovery', { discoveryHandler: handler, remount: options?.remount });
  }

  public addRpcHandler(apiUrl: string, options?: RouteClaimOptions) {
    // registry 也按前缀登记（与 HTTP 侧同一套 claim 簿记）：内置 `rpcApis` 与工具解析
    // 都从该前缀的 claim 上取注册表，不传则退到 transport / dispatcher 的那一份。
    this.claimRoute(apiUrl, 'rpc', { registry: options?.registry, remount: options?.remount });
  }

  protected async onReceive(message: MailMessage) {
    // 没有发现端点分叉：「无 toolId + act list/get」在 toRpcRequest 里经路由表解析成
    // 内置工具 `rpcApis`，于是它与业务调用走同一条流水线（validateRpcRequest / 身份判定 / 超时）。
    await this.processIncomingCall(message, message);
  }

  /** Mailbox 按地址路由：前缀就是它自己声明的那条（多条时取归一化 apiUrl 对应的那条）。 */
  private claimPrefixOf(): string {
    const self = this.toPathname(this.apiUrl || '/');
    if (this.routeClaims.has(self)) {return self;}
    const first = this.routeClaims.keys().next();
    return first.done ? '/' : first.value;
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
    let toolId = rpcHeaders[RPC_HEADERS.TOOL_ID];
    let act = rpcHeaders[RPC_HEADERS.ACT];
    const resId = rpcHeaders[RPC_HEADERS.RES_ID];
    const traceId = rpcHeaders[RPC_HEADERS.TRACE_ID];
    const reqId = rpcHeaders[RPC_HEADERS.REQUEST_ID] || (this.options?.strict === false ? msgId : undefined);

    // 路由表：无 toolId 且 act 是 list/get 时，它就是内置发现端点（`rpcApis`）。
    // 以前这里是一条分叉，直接回包不经 dispatcher；现在它只是一个寻址结果，
    // 所以 validateRpcRequest / 身份判定 / globalTimeout 都管得到它。
    if (!toolId) {
      const entry = this.matchRouteEntry(this.claimPrefixOf(), { path: '/', act });
      if (entry) {
        toolId = entry.toolId;
        if (entry.act) {act = entry.act;}
      }
    }

    if (!toolId) {
      throw new RpcError(`Invalid request to ${toStr}: missing tool identifier (rpc-fn)`, RpcStatusCode.BAD_REQUEST);
    }

    if (!reqId) {
      throw new RpcError(`Invalid request to ${toStr}: missing ${RPC_HEADERS.REQUEST_ID} in headers (Strict Mode)`, RpcStatusCode.BAD_REQUEST);
    }

    return {
      apiUrl: this.apiUrl, // 始终返回归一化的 Transport apiUrl
      toolId: toolId as string,
      act: act as string,
      resId: resId as string,
      clientId: rpcHeaders[RPC_HEADERS.CLIENT_ID] as string,
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

    this.pullLoopErrored = false;
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
      } catch (error: any) {
        // 不静默吞：只报一次，否则刷日志比故障本身还响
        if (!this.pullLoopErrored) {
          this.pullLoopErrored = true;
          console.warn(`[MailboxServerTransport] pull loop error on ${address}: ${error?.message || error}`);
        }
        await new Promise(resolve => setTimeout(resolve, this.pullInterval));
      }
    }
  }

  public async stop(force?: boolean): Promise<void> {
    this.isRunning = false;
    // 归属登记条目必须跟着释放（与 HttpServerToolTransport.stop 同一份约定）：
    // 不释放的话这个地址上的路由永久占位，下一个实例 registerServer 必报 Routing Conflict
    this.unregisterRoutes();
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
