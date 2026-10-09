import { defaultsDeep } from 'lodash-es';
import { ToolTransport, type IToolTransport, type ToolTransportOptions } from './base';
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
  /** 该前缀使用的工具注册表；请求期解析，避免后一次挂载覆盖前一次。 */
  registry?: any;
  /** 该前缀的发现处理器。 */
  discoveryHandler?: () => any;
  /** 重复声明时的行为，默认 'replace'。 */
  remount?: RouteRemountMode;
}

/** 一条已声明的逻辑路由（prefix 粒度，rpc / discovery 各自计数）。 */
export interface RouteClaim {
  /** 归一化前缀，无尾斜杠；根为 '/'。 */
  prefix: string;
  /** 声明该前缀时传入的 apiUrl，用于重建 ToolRpcRequest.apiUrl。 */
  apiUrl: string;
  registry?: any;
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
   * 获取物理层面的监听地址标识。
   * 默认返回 apiUrl。用于识别物理底座复用。
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
    return this._start(options);
  };

  /**
   * Template Method：处理物理请求流水线。
   * 下层具体协议收到请求后，将其转化为内部结构，送入 Dispatcher 并写回。
   */
  protected async processIncomingCall(rawReq: any, rawRes: any, registry?: any): Promise<void> {
    try {
      const rpcReq = await this.toRpcRequest(rawReq, rawRes);

      // 架构层校验：调用所属 Manager 实例进行策略审计 (SSRF 防御、白名单等)
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
   * apiUrl（完整 URL）或路径前缀 -> 归一化前缀（无尾斜杠，根为 '/'）。
   * 空路径归一为 '/'，因为多数路由表拒绝空 path。
   */
  protected toPathname(apiUrl: string): string {
    let pathname = apiUrl;
    if (/^https?:\/\//i.test(apiUrl)) {
      try {
        pathname = new URL(apiUrl).pathname;
      } catch (e) {
        // 非法 URL：按普通路径前缀处理
      }
    }
    if (!pathname.startsWith('/')) {pathname = `/${pathname}`;}
    // 压缩内部重复斜杠，避免 '/a//b' 与 '/a/b' 成为两条逻辑路由
    // （与 MailboxServerTransport.extractPath 的既有行为一致）
    pathname = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return pathname || '/';
  }

  /**
   * 前缀匹配用的 key：补尾斜杠，避免 '/api' 误匹配 '/apix'。
   * 仅用于匹配与物理路由表，逻辑路由（getRoutes / 审计）用归一化前缀。
   */
  protected toMatchPrefix(prefix: string): string {
    return prefix === '/' ? '/' : `${prefix}/`;
  }

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
