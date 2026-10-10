import { defaultsDeep } from 'lodash-es';
import { ToolTransport, type IToolTransport, type ToolTransportOptions } from './base';
import { normalizeRoutePath, routeMatchKey } from './route-path';
import { RpcServerDispatcher } from './dispatcher';
import { RpcTransportManager } from './server-manager';
import { ToolRpcRequest, ToolRpcResponse } from './models';

export interface ServerToolTransportOptions extends ToolTransportOptions {
  dispatcher?: RpcServerDispatcher;
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

  constructor(options?: ServerToolTransportOptions) {
    super(options);
    // Ensure server-side transports use RpcTransportManager (full version with SSRF protection)
    if (!options?.manager) {
      this.manager = RpcTransportManager.instance;
    }
    this.dispatcher = options?.dispatcher || RpcServerDispatcher.instance;
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
    try {
      const rpcReq = await this.toRpcRequest(rawReq, rawRes);

      // 架构层校验：调用所属 Manager 实例做策略校验 (SSRF 防御、白名单等)
      this.manager.validateRpcRequest(rpcReq);

      const rpcRes = await this.dispatcher.dispatch(rpcReq, registry);

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
      // 顶级异常防护 (Top-level pipeline guard)
      // 提取错误码，优先使用数字类型的 status 或 code
      let errCode = 500;
      if (typeof err.code === 'number') {
        errCode = err.code;
      } else if (typeof err.status === 'number') {
        errCode = err.status;
      }

      const errStatus = typeof err.status === 'string' ? err.status : 'error';

      await this.sendRpcResponse({
        status: (errCode >= 100 && errCode < 600) ? errCode : 500,
        error: {
          message: err.message || "Transport Pipeline Error",
          code: errCode,
          status: errStatus,
          data: err.data
        }
      }, rawRes);
    }
  }

  /** prefix -> 逻辑路由声明。多前缀 / 多注册表共用同一份簿记。 */
  protected routeClaims = new Map<string, RouteClaim>();

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

  public abstract addDiscoveryHandler(apiUrl: string, handler: () => any, options?: RouteClaimOptions): void;
  public abstract addRpcHandler(apiUrl: string, options?: RouteClaimOptions): void;
  public abstract _start(options?: any): Promise<any>;
  public abstract stop(force?: boolean): Promise<void>;
  public getRaw?(): any;
}
