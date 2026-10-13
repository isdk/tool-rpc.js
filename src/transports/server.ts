import { defaultsDeep } from 'lodash-es';
import { ToolTransport, type IToolTransport, type ToolTransportOptions } from './base';
import { normalizeRoutePath, routeMatchKey } from './route-path';
import { RpcServerDispatcher } from './dispatcher';
import { RpcTransportManager } from './server-manager';
import { RPC_HEADERS, ToolRpcRequest, ToolRpcResponse } from './models';
import { type RpcCredentialReader, type RpcIdentityContext, type RpcIdentityPolicy } from './identity';
import { readBearerCredential } from './identity-bearer';
import { RPC_APIS_TOOL_ID, manifestItem, manifestItems, registryEntries } from './rpc-apis';

export interface ServerToolTransportOptions extends ToolTransportOptions {
  dispatcher?: RpcServerDispatcher;
  /**
   * 身份策略：凭证 → 身份。**不传就是 no-op**，基类不启用任何身份逻辑，
   * 行为与今天逐字节一致。两个默认实现见 `identity-session.ts` / `identity-bearer.ts`。
   *
   * 装了它，业务调用与框架内置端点（当前只有发现端点）都走同一条判定；
   * 「哪个 API 必须认证」在策略里判（`allowAnonymous` 可以是谓词），不在 transport 上。
   */
  identity?: RpcIdentityPolicy;
  /**
   * 凭证取法（从原生 req 取一个字符串）。缺省读标准字段 `authorization`（去 Bearer 前缀）；
   * 私有 header 由部署写自己的 reader（契约 9）。
   */
  credentialReader?: RpcCredentialReader;
}

/**
 * 同一前缀的同类路由被重复声明时的处理方式。
 * - 'replace'（默认）：新的 registry / discoveryHandler 接管已声明的路由，不再重复注册物理路由。
 * - 'throw'：调用 onDuplicateRoute 抛出（框架自有的重复路由错误，或基类通用错误）。
 */
export type RouteRemountMode = 'replace' | 'throw';

/** 声明路由时可携带的逻辑信息。 */
export interface RouteClaimOptions {
  /**
   * 该前缀的**工具注册表**（`ServerTools` 那种：`registry.get(toolId)`，没有 `get`
   * 就退化成 `registry[toolId]`，取到的 tool 有 `run` / `params` / `stream`）。
   * 类型是 `any` 因为框架不关心工具形态，只要求这两个取法。
   *
   * 它不是「路由注册表」（物理路由表在 transport 自己那里，如 HTTP 的
   * `binding.routes`），而且**按前缀绑定**而不是挂在 transport 上：一个 transport
   * 可以服务多个前缀，各自的工具集不同；若共用 `this.registry`，第二次
   * `mount(RegB, '/v2')` 就会把 `/api` 也改指向 RegB。请求期由 `routeRegistry(prefix)`
   * 解析，没有 claim 时才退回 transport 自己的 registry，最后才是 dispatcher 的。
   */
  registry?: any;
  /** 该前缀的发现处理器（`mount` 里就是 `() => serverTools.toJSON()`）。同样按前缀绑定。 */
  discoveryHandler?: () => any;
  /** 重复声明时的行为，默认 'replace'。 */
  remount?: RouteRemountMode;
}

/**
 * 一条已声明的逻辑路由（prefix 粒度，rpc / discovery 各自计数）。
 *
 * **`prefix` 与 `apiUrl` 的分工：一个是路由身份，一个是原始声明。**
 *
 * - `apiUrl`：调用方原样传进来的声明（`addRpcHandler` / `addDiscoveryHandler` /
 *   `mount` 的参数）。可以是任何 scheme 的完整 URL，也可以是裸 path 前缀，还可能
 *   带着 `//`、`.` / `..`、尾斜杠、percent-encoding。
 * - `prefix`：`toPathname(apiUrl)` 的产物，即 `normalizeRoutePath(apiUrl,
 *   { mode: 'request' })` 的 canonical path——绝对路径、无尾斜杠（根为 `/`）、
 *   段已解码、dot 段已解析。声明侧与请求侧走同一套规则，所以 claim 的 key 与请求
 *   命中的 key 必然一致。
 *
 * 谁用哪个：
 * - `prefix` 是 `routeClaims` 的 map key、`getRoutes()` 的内容、归属表的路由部分；
 *   物理分发表用 `toMatchPrefix(prefix)`（补尾斜杠，所以 `/api` 不会误配 `/apix`）。
 * - `apiUrl` 的**地址部分不参与任何 key**：底座归 `getListenAddr()` 管，所以
 *   `http://h:3000/api` 与 `/api` 得到同一个 prefix。保留原值是为了请求期重建
 *   `ToolRpcRequest.apiUrl`（Manager 的 SSRF 校验按它匹配）：Fastify 优先用命中
 *   claim 的 `apiUrl`，HTTP 用 transport 的 apiUrl + Host 头，Mailbox 固定用自己的。
 *
 * `rpc` / `discovery` 各自计数：同一前缀上先声明发现路由再声明 RPC 不算重复；
 * 同类第二次声明才走 `remount`（默认 replace：只换 registry / discoveryHandler 并告警，
 * 不重复注册物理路由；`throw` 经 `onDuplicateRoute` 抛错）。`prefix` 一旦建立就不变。
 */
export interface RouteClaim {
  /** 归一化前缀（canonical path），无尾斜杠；根为 '/'。路由身份，也是 map key。 */
  prefix: string;
  /** 声明该前缀时传入的原始 apiUrl（不参与 key；请求期用于重建 ToolRpcRequest.apiUrl）。 */
  apiUrl: string;
  /** 该前缀的工具注册表（为何按前缀绑定见 `RouteClaimOptions.registry`）。 */
  registry?: any;
  /** 该前缀的发现处理器。 */
  discoveryHandler?: () => any;
  /** 是否已声明 RPC 路由。 */
  rpc: boolean;
  /** 是否已声明发现路由。 */
  discovery: boolean;
}

/**
 * 路由表里的一条：**前缀内的一个路径（+ 命中条件）→ 一个工具寻址结果**。
 *
 * 它是「路由层」的映射，与「注册表层」（toolId → 工具实例）分开：
 * - 路由表回答「这个请求算调哪个工具」
 * - 注册表回答「那个工具是什么」
 *
 * 内置发现端点就是表里的一行（前缀根 + GET → `rpcApis`），所以它和业务 API 走同一条
 * 流水线（`validateRpcRequest` / 身份判定 / `globalTimeout` / Tracker），没有旁路分支。
 */
export interface RouteEntry {
  /**
   * **前缀内**路径，归一化后（`normalizeRoutePath`）。前缀根本身是 `'/'`；
   * `''` 与 `'/'` 同义（`normalizeRoutePath` 把空串当根），`/x` 与 `/x/` 默认同义。
   */
  path: string;
  /** 命中条件。都不写就是「该路径上任何请求都算」。 */
  when?: {
    /**
     * HTTP method。声明侧大小写不敏感（`addRoute` 存进表时归成大写），
     * 表里与匹配用的始终是大写值。Mailbox 没有 method，这一项自然不命中。
     */
    method?: string;
    /** 请求已带上的 act。 */
    act?: string;
  };
  /** 命中后解析到的工具 id（在注册表里查，查不到由 dispatcher 报 404）。 */
  toolId: string;
  /** 命中后要赋的 act；不写就沿用请求里的。 */
  act?: string;
  /** 命中后要赋的 resId；不写就沿用请求里的。 */
  resId?: string;
}

/** 查路由表时的输入（transport 从原生请求算出来）。 */
export interface RouteMatchInput {
  /** 前缀内的归一化路径（根为 '/'）。 */
  path: string;
  method?: string;
  act?: string;
}

export interface IServerToolTransport extends IToolTransport {
  dispatcher: RpcServerDispatcher;

  /** 是否支持原生的流式传输 (如 HTTP 支持, Mailbox 通常不支持) */
  canStream?: boolean;

  /**
   * 启动物理监听
   */
  start(options?: any): Promise<any>;

  /**
   * 停止物理监听
   */
  stop(force?: boolean): Promise<void>;

  /**
   * 本服务可被访问的地址（native address）。
   *
   * 对框架而言它是**不透明字符串**：只用作路由归属登记与底座复用的 map key，以及日志。
   * 框架不解析、不校验、不预测 bind 冲突——地址语义归按 scheme 分派到的那个 transport
   * 自己管（监听、port 0 后补全真实端口、要不要把回环写法规范化，都是它的事）。
   * 真撞了，内核报 EADDRINUSE，fail fast。
   *
   * 默认就是 apiUrl。没有 URL 表示的 transport（unix socket、进程内总线）覆写它，
   * **返回一个字符串**即可（`unix:/run/ai.sock`、`mem://bus-a`），不需要任何 URI 工具。
   */
  getListenAddr(): string | string[];

  /**
   * 获取该实例声明负责的逻辑路由列表。
   * 默认返回 ["/"] 表示接管该物理地址下的全量路径。
   */
  getRoutes(): string[];

  getRaw?(): any;
}

export abstract class ServerToolTransport extends ToolTransport implements IServerToolTransport {
  declare apiUrl: string;
  declare options?: ServerToolTransportOptions;
  public dispatcher: RpcServerDispatcher;
  public canStream: boolean = false;

  /** 身份策略；undefined = 未装，请求流水线不碰身份。 */
  protected identity?: RpcIdentityPolicy;
  /** 凭证取法；缺省读 `authorization`。 */
  protected credentialReader?: RpcCredentialReader;

  constructor(options?: ServerToolTransportOptions) {
    super(options);
    // Ensure server-side transports use RpcTransportManager (full version with SSRF protection)
    if (!options?.manager) {
      this.manager = RpcTransportManager.instance;
    }
    this.dispatcher = options?.dispatcher || RpcServerDispatcher.instance;
    this.identity = options?.identity;
    this.credentialReader = options?.credentialReader;
  }

  /**
   * 本服务可被访问的地址。对框架不透明：只当 map key 与日志用，不解析、不校验。
   * 默认就是 apiUrl；有真实监听的 transport 自行覆写（见 HttpServerToolTransport）。
   */
  public getListenAddr(): string | string[] {
    return this.apiUrl;
  }

  /**
   * 该实例声明负责的逻辑路由：每个前缀一条（归一化，无尾斜杠）。
   * 尚未声明任何路由时返回 ['/']，即接管该物理地址下的全量路径。
   * 需要前缀匹配形式（补尾斜杠）的后端请用 toMatchPrefix()。
   */
  public getRoutes(): string[] {
    return this.routeClaims.size > 0 ? [...this.routeClaims.keys()] : ['/'];
  }

  public start(options?: any): Promise<any> {
    if (this.options) { options = defaultsDeep(options, this.options); }
    // 归属登记是 registerServer() 时按当时的地址建的；地址可能到 start 才定下来
    // （`start({ port })` 改写、port 0 由内核挑）。所以这里按当前地址重登一次。
    this.registerRoutes();
    return this._start(options);
  };

  /**
   * 把本实例当前的「地址 → 它负责的逻辑路由」登记到 Manager 的路由归属表上。
   * 地址变了（`start({ port })` 改写、`port: 0` 观测到真实端口）就重登一次，
   * 否则登记停在旧地址上：对真实地址漏报、对让出去的地址过报冲突。
   * 每次重算声明地址，不累加。Manager 没有归属表（客户端 manager）时静默跳过。
   *
   * 地址的内容框架不看：同一个 key 就是同一个底座，key 报得对不对归 transport 自己。
   */
  protected registerRoutes(): void {
    const manager: any = this.manager;
    if (manager && typeof manager.refreshServerRegistration === 'function') {
      manager.refreshServerRegistration(this);
    }
  }

  /**
   * 注销本实例在 Manager 路由归属表上占的路由（stop 时必调）。
   * 不调就会把路由永久锁在归属表上：stop 后同一前缀再上服务必报 Routing Conflict。
   */
  protected unregisterRoutes(): void {
    const manager: any = this.manager;
    if (manager && typeof manager.unregisterServer === 'function') {
      manager.unregisterServer(this);
    }
  }

  /**
   * Template Method：处理物理请求流水线。
   * 下层具体协议收到请求后，将其转化为内部结构，送入 Dispatcher 并写回。
   */
  protected async processIncomingCall(rawReq: any, rawRes: any, registry?: any): Promise<void> {
    // 寻址结果要在 try 外拿着：顶级防护要拿它回显 req-id 并叫审计钩子（issue #10）。
    // `toRpcRequest` 自己报错时它就是 `undefined`（连寻址都没成，只能不给 req-id）。
    let rpcReq: ToolRpcRequest | undefined;
    try {
      rpcReq = await this.toRpcRequest(rawReq, rawRes);

      // 身份判定：插在 toRpcRequest 之后、validateRpcRequest 之前，
      // 这样 Manager 的架构层校验（SSRF / 拦截钩子）能看到 request.identity。
      await this.resolveRequestIdentity(rpcReq, rawReq, rawRes);

      // 架构层校验：调用所属 Manager 实例做策略校验 (SSRF 防御、白名单等)
      this.manager.validateRpcRequest(rpcReq);

      // 注册表按前缀分层解析（前缀 claim → transport → dispatcher → 系统）。
      // 调用方显式传进来的 registry 优先级最高（适配器自己指定的场景）。
      const rpcRes = await this.dispatcher.dispatch(rpcReq, registry ?? this.requestRegistry(rpcReq));

      // 能力预检：如果返回的是流，但传输层不支持流，应当报错
      if (!this.canStream && rpcRes.data && (rpcRes.data instanceof ReadableStream || typeof rpcRes.data.getReader === 'function')) {
        rpcRes.status = 400;
        rpcRes.data = undefined;
        rpcRes.error = {
          code: 400,
          status: 'bad_request',
          message: `Streaming output is not supported by current transport protocol: ${this.apiUrl}`
        };
      }

      await this.sendRpcResponse(rpcRes, rawRes);
    } catch (err: any) {
      // 顶级异常防护 (Top-level pipeline guard)：策略抛的 401 与业务抛的都走这里
      await this.sendPipelineError(err, rawRes, rpcReq);
    }
  }

  /**
   * 框架侧的身份判定入点：取凭证 → `match` → 必要时 `assign` → 写 `request.identity`。
   * 内置发现端点（`rpcApis`）也是普通工具，所以它与业务调用走的是同一次判定，没有第二条路。
   *
   * 没装策略就是 no-op（基类不启用任何身份逻辑）。每请求现算，不缓存策略的返回值；
   * 三个钩子一律 await（`match`/`assign`/`revoke` 同步异步都可）。策略抛出的错误
   * （如 401）由 `processIncomingCall` 的顶级防护映射成响应，不在这里吞。
   *
   * 分工边界（设计文档 §10）：框架侧只备料与调接口；状态、TTL、计数器、凭证的 wire
   * 位置与交付通道全在策略内。
   */
  protected async resolveRequestIdentity(rpcReq: ToolRpcRequest, rawReq?: any, rawRes?: any): Promise<void> {
    const policy = this.identity;
    if (!policy) {return;}

    const ctx: RpcIdentityContext = {
      // req/res 是逃生口：框架侧不解析它们（交付凭证、取 socket 地址都归策略）
      req: rawReq ?? rpcReq.raw?._req,
      res: rawRes ?? rpcReq.raw?._res,
      headers: rpcReq.headers,
      prefix: this.matchedPrefix(rpcReq),
      apiUrl: rpcReq.apiUrl,
      // 寻址结果与注册表里的工具实例：策略要按 API 决定认不认（`allowAnonymous` 可以是谓词），
      // 靠的就是这些只读备料。框架不读 `tool` 的任何字段，也不解释它的含义。
      toolId: rpcReq.toolId,
      act: rpcReq.act,
      resId: rpcReq.resId,
      tool: this.resolveRouteTool(rpcReq),
    };

    // 内置 reader 只读标准字段；拿不到原生 req 时退到已归一化的 headers（HTTP / Mailbox 都有）
    const reader = this.credentialReader ?? readBearerCredential;
    ctx.credential = reader(ctx.req ?? rpcReq);
    // 标上「transport 已读过凭证」：`credential === undefined` 从此意味着「reader 说了算，
    // 这个请求没带我要的凭证」，策略不能回头自己读 `authorization`（issue #3）。
    ctx.credentialRead = true;

    const matched = await policy.match(ctx);
    // match 返回 undefined = 另起新会话（不是拒绝）；拒绝由策略抛错，走顶级防护
    const identity = matched ?? await policy.assign(ctx);

    rpcReq.identity = identity;
    // 装了策略 → clientId 由服务端判定值接管（契约 3）；采信什么由策略决定，
    // 基类不把 header 值塞进 clientId（契约 4）
    rpcReq.clientId = identity.id;
  }

  /**
   * 顶级防护的出口：把流水线（身份判定、`validateRpcRequest`、dispatcher、业务工具）抛出的错误
   * 映射成 RPC 错误封包并写回。取码规则统一（`err.code` 数字优先，其次 `err.status` 数字，否则 500），
   * 所以内置发现端点被策略拒绝时，客户端拿到的错误形状与业务调用被拒绝时相同。
   *
   * 两件事与正常响应路径对齐（issue #10）：回显 `req-id`，并把这条请求交给
   * `manager.onRequestRejected`（审计钩子，默认 no-op）。
   */
  protected async sendPipelineError(err: any, rawRes: any, rpcReq?: ToolRpcRequest): Promise<void> {
    // 审计钩子（issue #10）：身份判定与 `validateRpcRequest` 拒掉的请求到不了后者的正常调用点
    // （判定在前、校验在后），所以拿钩子当日志的部署恰好看不到「最想进日志的那批尝试」。
    // 钩子自己报错不能掉响应：审计失败不该把 401 变成 500。
    const manager: any = this.manager;
    if (manager && typeof manager.onRequestRejected === 'function') {
      try {
        manager.onRequestRejected(rpcReq, err);
      } catch (hookErr) {
        console.warn('[tool-rpc] manager.onRequestRejected threw:', hookErr);
      }
    }

    let errCode = 500;
    if (typeof err?.code === 'number') {
      errCode = err.code;
    } else if (typeof err?.status === 'number') {
      errCode = err.status;
    }

    await this.sendRpcResponse({
      status: (errCode >= 100 && errCode < 600) ? errCode : 500,
      // 回显 req-id（issue #10）：正常路径由 `dispatcher.echoRequestId` 做，流水线错误以前没有。
      // 客户端对不上自己那次调用的，恰恰就是失败的那些——日志关联最难的那批。
      headers: rpcReq?.requestId ? { [RPC_HEADERS.REQUEST_ID]: rpcReq.requestId } : undefined,
      error: {
        message: err?.message || 'Transport Pipeline Error',
        code: errCode,
        status: typeof err?.status === 'string' ? err.status : 'error',
        data: err?.data,
      }
    }, rawRes);
  }

  /**
   * 取本次请求会解析到的工具实例，给策略当**只读备料**（策略可读注册时带的自定义字段）。
   * 解析顺序与实际分发完全同一套（见 `requestRegistry`），所以策略看到的 `tool` 就是
   * 待会儿真会被调的那个。解析不到就是 undefined，不抛错——工具不存在由 dispatcher 报 404，
   * 不在身份这一步抢它的活。
   */
  protected resolveRouteTool(rpcReq: ToolRpcRequest): any {
    if (!rpcReq.toolId) {return undefined;}
    return this.requestRegistry(rpcReq).get(rpcReq.toolId);
  }

  /**
   * 本次请求的**注册表视图**：把「前缀 claim 的 registry → transport 自己的 → dispatcher 的 →
   * 系统保留」叠成一个 `get(toolId)` 视图，交给 dispatcher。
   *
   * 为什么要有它：`mount(RegB, '/v2')` 把注册表**按前缀**声明下来，但 dispatcher 只拿得到
   * 一个全局 `registry`。不分层，多前缀就会共用最后一个注册表（`/api` 被 `/v2` 改掉）。
   * 内置发现工具也从这里取清单（`ctx.registry`），所以它列的是**命中前缀**的工具，不是全局的。
   *
   * 系统保留层（`rpcTask` / `rpcApis`）排在最后：业务注册表里注册同名 id 就覆盖内置，
   * 这是有意的扩展点。
   */
  protected requestRegistry(rpcReq: ToolRpcRequest): any {
    const prefix = this.matchedPrefix(rpcReq);
    const claim = prefix ? this.routeClaims.get(prefix) : undefined;

    const layers: any[] = [];
    for (const candidate of [claim?.registry, (this as any).registry, this.dispatcher?.registry]) {
      if (candidate) {layers.push(candidate);}
    }

    const lookup = (toolId: string): any => {
      // 该前缀声明过自定义发现处理器 → 它就是该前缀的 `rpcApis` 实现（兼容旧 API）
      if (toolId === RPC_APIS_TOOL_ID && claim?.discoveryHandler) {
        return this.discoveryTool(claim.discoveryHandler);
      }
      for (const registry of layers) {
        const tool = typeof registry.get === 'function' ? registry.get(toolId) : registry[toolId];
        if (tool) {return tool;}
      }
      return this.dispatcher?.getSystemTool?.(toolId);
    };

    // 清单合并：后面的层不覆盖前面同名的工具——与 `get()` 同一套优先级，
    // 清单里那个条目就是真会被调的那个。
    const merge = (parts: any[]): Record<string, any> => {
      const out: Record<string, any> = {};
      for (const part of parts) {
        for (const [id, tool] of Object.entries(part ?? {})) {
          if (!(id in out)) {out[id] = tool;}
        }
      }
      return out;
    };

    return {
      get: lookup,
      /**
       * 发现工具列清单读的就是 `ctx.registry`，所以这个视图也要**列得全**（issue #1）。
       *
       * 两条规则，都与 `get()` 的分层语义对齐：
       *
       * - **每一层都算**：会 `toJSON` 的层合并起来，不是只取第一个。只取第一个时，
       *   `mount(RegB, '/v2')` 加 transport 自己的注册表会让另一层的工具从清单里消失，
       *   可它们照样被 `get()` 解析到、照样能被调用——清单与寻址不一致。
       * - **不会 `toJSON` 的层也要枚举**（`items` / `entries` / 自有键，见 `registryEntries`）。
       *   以前这里在没有任何一层会 `toJSON` 时回 `undefined`，而 `rpcApis` 只看「有没有
       *   `toJSON` 这个方法」就照单全收，于是它自己那三条枚举分支在 transport 后面永远走不到，
       *   线上就是 `200 {}`。
       *
       * 某层的 `toJSON()` 回空（`undefined` / `null`）不算清单，那一层退到枚举；
       * 异步清单（回 Promise）整体回一个 Promise，由 dispatcher 等。
       */
      toJSON: () => {
        // 每一层各自交清单：会 `toJSON` 就用它（可以是 Promise），不会就按形态枚举这一层。
        const parts = layers.map(registry => {
          if (typeof registry.toJSON === 'function') {
            const json = registry.toJSON();
            // 清单形态归注册表自己定，但「不导出 `func`」是框架的保证（issue #9）：
            // 它交的每一条也要过 `manifestItem`，否则自定义注册表能绕过剔除。
            if (json) {return manifestItems(json);}
          }
          const out: Record<string, any> = {};
          for (const [id, tool] of registryEntries(registry)) {
            out[id] = manifestItem(tool);
          }
          return out;
        });

        if (parts.some(part => typeof part?.then === 'function')) {
          return Promise.all(parts).then(merge);
        }
        return merge(parts);
      },
    };
  }

  /**
   * 把旧的 `addDiscoveryHandler` 处理器包成一个工具（不声明自己的超时，与内置 `rpcApis`
   * 一致：它受 `globalTimeout` 管，没有豁免，见 issue #8）。
   * 返回值带 `toJSON()` 就调它（`mount` 传的就是 `() => serverTools.toJSON()`，
   * Mailbox 旧行为也会做这一步归一）。
   */
  protected discoveryTool(handler: () => any): any {
    return {
      run: async () => {
        const result = await handler();
        return (result && typeof result.toJSON === 'function') ? result.toJSON() : result;
      },
    };
  }

  /**
   * 本请求命中的逻辑前缀（最长匹配）。同一 transport 服务多个前缀时，
   * 策略可按前缀分租户，注册表分层与路由表也按它解析。尚未声明任何路由时返回 undefined。
   *
   * 基类只能从 `apiUrl` 反推；已经做过物理分发的 transport（HTTP）应该覆写它，
   * 直接取分发阶段算好的那个，避免两侧各算一次最长匹配。
   */
  protected matchedPrefix(rpcReq: ToolRpcRequest): string | undefined {
    if (this.routeClaims.size === 0) {return undefined;}

    const path = this.toPathname(rpcReq.apiUrl || '');
    let best: string | undefined;
    for (const prefix of this.routeClaims.keys()) {
      if ((path === prefix || path.startsWith(this.toMatchPrefix(prefix)))
        && (!best || prefix.length > best.length)) {
        best = prefix;
      }
    }
    return best;
  }

  /** prefix -> 逻辑路由声明。多前缀 / 多注册表共用同一份簿记。 */
  protected routeClaims = new Map<string, RouteClaim>();

  /** prefix -> 该前缀的路由表条目（前缀内路径 → 工具寻址）。内置发现端点就在里面。 */
  protected routeTable = new Map<string, RouteEntry[]>();

  /**
   * 每个被声明的前缀自带的内置路由行——发现端点。
   *
   * 三行而不是两行，是因为两种 transport 的「怎么算发现请求」不同，而它们互不命中：
   * - HTTP：`GET <前缀根>`（`when.method`）；客户端 `loadApis()` 会带 `act: 'get'`，
   *   所以 `when.act` 那两行也命中同一工具，只是赋的 act 不同（无 `resId` 时都是列全量）。
   * - Mailbox：没有 method，只有 `act: 'list' | 'get'` 且无 `toolId` 才是发现请求。
   *
   * 它们不是特权开关，就是表里的普通行：第三方用同一个 `addRoute()` 写同一路径同条件就能换掉。
   */
  protected builtinRouteEntries(): RouteEntry[] {
    return [
      { path: '/', when: { method: 'GET' }, toolId: RPC_APIS_TOOL_ID, act: 'list' },
      { path: '/', when: { act: 'list' }, toolId: RPC_APIS_TOOL_ID, act: 'list' },
      { path: '/', when: { act: 'get' }, toolId: RPC_APIS_TOOL_ID, act: 'get' },
    ];
  }

  /** 同一路径 + 同一命中条件算同一条声明（`addRoute` 重复声明时按这个 key 替换）。 */
  private routeEntryKey(entry: RouteEntry): string {
    return `${entry.path}|${entry.when?.method ?? '*'}|${entry.when?.act ?? '*'}`;
  }

  /** 前缀刚建立时铺上内置行（已存在的同 key 条目不覆盖，所以 transport 覆写过就保持覆写）。 */
  private ensureBuiltinRoutes(prefix: string): void {
    const rows = this.routeTable.get(prefix) ?? [];
    for (const entry of this.builtinRouteEntries()) {
      const key = this.routeEntryKey(entry);
      if (rows.some(row => this.routeEntryKey(row) === key)) {continue;}
      rows.push(entry);
    }
    this.routeTable.set(prefix, rows);
  }

  /**
   * 声明一条路由：把前缀内的一个路径（可附 method / act 条件）映射到一个工具 id。
   *
   * 这是内置发现端点用的同一个入口（第三方没有特殊通道，也没有特殊限制）：
   * `addRoute('/api', { path: '/', when: { method: 'GET' }, toolId: 'myRoot' })`
   * 就把「GET /api」换到自己工具上。
   *
   * 路径写 `''` 与 `'/'` 同义（都归一为前缀根）；`/x` 与 `/x/` 默认同义
   * （`strictTrailingSlash: true` 才分成两条）。命中条件不写就是该路径上任何请求都算。
   */
  public addRoute(apiUrl: string, entry: RouteEntry): void {
    const prefix = this.toPathname(apiUrl);
    if (!this.routeClaims.has(prefix)) {
      // 路由表按前缀组织，前缀不存在就先建一个 claim（只带 apiUrl，不带 registry）。
      // 不标 rpc / discovery，所以不会与后续 `addRpcHandler` 撞重复声明。
      this.routeClaims.set(prefix, { prefix, apiUrl, rpc: false, discovery: false });
    }
    this.ensureBuiltinRoutes(prefix);

    const rows = this.routeTable.get(prefix)!;
    // 先归一再算 key：否则 `path: ''` 与 `path: '/'` 会当成两条声明（它们是同一个路由）。
    // `when.method` 一并归成大写：`matchRouteEntry` 与它比的是 `rawReq.method`，
    // Node 的 HTTP 永远大写（issue #7）——不归一的话 `{ method: 'get' }` 是一条
    // 永不命中的声明，而且它与大写声明的 key 不同，连「替换内置行」都做不到。
    const normalized: RouteEntry = {
      ...entry,
      path: normalizeRoutePath(entry.path, { mode: 'request', strictTrailingSlash: this.strictTrailingSlash }).path,
      when: entry.when ? { ...entry.when, method: entry.when.method?.toUpperCase() } : entry.when,
    };
    const key = this.routeEntryKey(normalized);
    const existing = rows.findIndex(row => this.routeEntryKey(row) === key);
    if (existing >= 0) {
      rows[existing] = normalized;
    } else {
      rows.push(normalized);
    }
  }

  /** 当前路由表（含内置行），按前缀展开。适配器可以拿它去自己框架里原生注册。 */
  public getRouteTable(): Array<RouteEntry & { prefix: string }> {
    const out: Array<RouteEntry & { prefix: string }> = [];
    for (const [prefix, rows] of this.routeTable) {
      for (const row of rows) {out.push({ prefix, ...row });}
    }
    return out;
  }

  /** 路由表里有没有任何条目。空表 = 这个 transport 一个前缀都没声明，寻址不可能命中。 */
  protected hasRouteEntries(): boolean {
    for (const rows of this.routeTable.values()) {
      if (rows.length) {return true;}
    }
    return false;
  }

  /**
   * 寻址落空时的下一步提示（issue #5）。
   *
   * 空表时那句 `Missing routing information: rpc-fn header or valid URL Path` 会让人去改 URL，
   * 而真正的问题是**这个 transport 还没声明任何前缀**（`addRpcHandler` / `addRoute`）——
   * 内置发现端点也只在有前缀之后才存在。错误要说清这一步。
   */
  protected emptyRouteTableHint(): string {
    return this.hasRouteEntries() ? '' : ' (no route claimed for this transport: call addRpcHandler(apiUrl) or addRoute(...) first — the built-in discovery endpoint only exists for a claimed prefix)';
  }

  /**
   * 查路由表：本次请求在该前缀内命中哪条声明。
   * 按声明顺序取第一条命中（内置行先铺，所以第三方同 key 的声明会替换它，而不是被它抢）。
   *
   * 入参路径先过一遍归一化再比：表里的行是**编码态**（`addRoute` 存的就是
   * `normalizeRoutePath().path`），而 HTTP 递过来的是按段解码后的值（`/中/api`、`/a b`）。
   * 不归一就会漏配：工具名里有空格 / 非 ASCII / 需要转义的字符时，声明在表里的路由永远命不中。
   * 归一化幂等，所以已经归一过的入参（Mailbox 的 `'/'`）不受影响。
   */
  protected matchRouteEntry(prefix: string, input: RouteMatchInput): RouteEntry | undefined {
    const rows = this.routeTable.get(prefix);
    if (!rows) {return undefined;}

    const matchPath = normalizeRoutePath(input.path, { mode: 'request', strictTrailingSlash: this.strictTrailingSlash }).path;
    for (const row of rows) {
      if (row.path !== matchPath) {continue;}
      if (row.when?.method && row.when.method !== input.method) {continue;}
      if (row.when?.act && row.when.act !== input.act) {continue;}
      return row;
    }
    return undefined;
  }

  /**
   * apiUrl（完整 URL，任何 scheme）或路径前缀 -> 归一化前缀（根为 '/'）。
   * 规则由 route-path.ts 的 normalizeRoutePath 提供，与请求侧完全同一套：
   * 折叠 `//`、解析 dot 段、按段解码、`%2F` 不当分隔符、尾斜杠默认等价。
   * 空路径归一为 '/'，因为多数路由表拒绝空 path。
   */
  protected toPathname(apiUrl: string): string {
    return normalizeRoutePath(apiUrl, { mode: 'request', strictTrailingSlash: this.strictTrailingSlash }).path;
  }

  /**
   * 前缀匹配用的 key：补尾斜杠，避免 '/api' 误匹配 '/apix'。
   * 仅用于匹配与物理路由表，逻辑路由（getRoutes / 归属登记）用归一化前缀。
   */
  protected toMatchPrefix(prefix: string): string {
    return routeMatchKey(prefix);
  }

  /**
   * `/foo` 与 `/foo/` 是否算两条路由。默认 false（等价）；置 true 后声明与匹配
   * 都保留尾斜杠。每个实例声明时必须一致，否则 claim key 与匹配 key 会错位。
   */
  protected strictTrailingSlash: boolean = false;

  /**
   * 声明一条逻辑路由，并合并 registry / discoveryHandler。
   *
   * 返回 claim 表示子类需要注册对应的物理路由；返回 null 表示该
   * (prefix, kind) 已声明过——逻辑信息已更新，物理路由无需（也不应）重复注册。
   */
  protected claimRoute(apiUrl: string, kind: 'rpc' | 'discovery', options: RouteClaimOptions = {}): RouteClaim | null {
    const prefix = this.toPathname(apiUrl);
    const existing = this.routeClaims.get(prefix);

    if (!existing) {
      const claim: RouteClaim = {
        prefix,
        apiUrl,
        registry: options.registry,
        discoveryHandler: options.discoveryHandler,
        rpc: kind === 'rpc',
        discovery: kind === 'discovery',
      };
      this.routeClaims.set(prefix, claim);
      this.ensureBuiltinRoutes(prefix);
      return claim;
    }

    if (existing[kind]) {
      if (options.remount === 'throw') {
        this.onDuplicateRoute(prefix, kind);
      }
      if (options.registry !== undefined) {existing.registry = options.registry;}
      if (options.discoveryHandler !== undefined) {existing.discoveryHandler = options.discoveryHandler;}
      console.warn(`[ServerToolTransport] ${kind} route for "${prefix}" is already claimed; the registry/handler have been replaced.`);
      return null;
    }

    existing[kind] = true;
    if (options.registry !== undefined) {existing.registry = options.registry;}
    if (options.discoveryHandler !== undefined) {existing.discoveryHandler = options.discoveryHandler;}
    this.ensureBuiltinRoutes(prefix);
    return existing;
  }

  /**
   * 重复声明同一前缀同类路由时的钩子（remount: 'throw'）。
   * 基类抛出通用错误；自带路由表的后端（如 Fastify/find-my-way）可覆写为
   * 触发框架原生的重复路由错误。
   */
  protected onDuplicateRoute(prefix: string, kind: 'rpc' | 'discovery'): never {
    throw new Error(`Route already claimed: ${kind} route for "${prefix}" on ${this.apiUrl || 'this transport'}`);
  }

  /** 请求期解析：该前缀由哪个注册表服务。 */
  protected routeRegistry(prefix: string): any {
    return this.routeClaims.get(prefix)?.registry;
  }

  /** 请求期解析：该前缀的发现处理器。 */
  protected routeDiscoveryHandler(prefix: string): (() => any) | undefined {
    return this.routeClaims.get(prefix)?.discoveryHandler;
  }

  /** 该前缀声明时使用的 apiUrl（用于重建 ToolRpcRequest.apiUrl）。 */
  protected routeApiUrl(prefix: string): string | undefined {
    return this.routeClaims.get(prefix)?.apiUrl;
  }

  protected abstract toRpcRequest(rawReq: any, rawRes?: any): Promise<ToolRpcRequest>;
  protected abstract sendRpcResponse(rpcRes: ToolRpcResponse, rawRes: any): Promise<void>;

  /**
   * 声明该前缀的**发现处理器**（列工具清单的返回内容）。
   *
   * @deprecated 发现端点已由内置工具 `rpcApis` 接管（见 `addRoute` / `builtinRouteEntries`），
   * 不传处理器也有清单。只有「要自定义这个前缀列什么」时才还需要它：清单内容以外的东西
   * （认证、超时、`validateRpcRequest`、审计）已经不再由它接管，而是走内置工具那条流水线。
   * 迁移：通常只需 `addRpcHandler(prefix)`（清单由内置 `rpcApis` 从该前缀的注册表出）；
   * 要自定义清单内容，要么保留本方法，要么自己注册一个工具再
   * `addRoute(prefix, { path: '/', when: { method: 'GET' }, toolId: 'myListing' })`。
   *
   * 它只换清单内容，不是一条独立路由：发现请求本身由路由表里那行内置声明解析到内置工具
   * `rpcApis`，所以它和业务 API 走同一条流水线——`validateRpcRequest` 拦得到、
   * 身份策略判定得到、`globalTimeout` 管得到。策略里要单独决定它认不认，用 `ctx.toolId === 'rpcApis'`。
   *
   * 不传处理器也有清单（内置工具从该前缀的注册表取 `toJSON()`）；传了就以它为准。
   */
  public abstract addDiscoveryHandler(apiUrl: string, handler: () => any, options?: RouteClaimOptions): void;

  /**
   * `addDiscoveryHandler` 的迁移提示。进程级只打一次：它不是错误，刷屏会把真正的告警埋掉
   * （每次请求都打一次尤其糟糕——发现调用往往在启动路径上）。
   */
  private static discoveryDeprecationWarned = false;
  protected warnDiscoveryDeprecated(): void {
    if (ServerToolTransport.discoveryDeprecationWarned) {return;}
    ServerToolTransport.discoveryDeprecationWarned = true;
    console.warn(
      '[tool-rpc] addDiscoveryHandler() is deprecated: service discovery is now served by the ' +
      'built-in `rpcApis` tool (addRpcHandler is enough). Keep it only to override the listing ' +
      'content for this prefix.'
    );
  }
  public abstract addRpcHandler(apiUrl: string, options?: RouteClaimOptions): void;
  public abstract _start(options?: any): Promise<any>;
  public abstract stop(force?: boolean): Promise<void>;
  public getRaw?(): any;
}
