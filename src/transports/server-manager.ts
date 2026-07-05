import { IToolTransport } from "./base";
import { IServerToolTransport } from "./server";
import { ToolRpcRequest } from "./models";
import { isRegExpStr, toRegExp } from "util-ex";
import { RpcClientTransportManager } from "./client-manager";

type RestrictedPattern = string | RegExp;

/**
 * RPC 传输管理器（服务端完整版）
 * 继承了 RpcClientTransportManager 的客户端能力，额外增加了服务端生命周期管理、
 * 路由审计和 SSRF 防护。
 * 
 * 在 Node.js 环境中使用此类以保持完全的向后兼容。
 */
export class RpcTransportManager extends RpcClientTransportManager {
  private static _serverInstance: RpcTransportManager;

  /** 服务端传输实例集合 (用于闭环生命周期管理) */
  private servers = new Set<IServerToolTransport>();

  /** 路由审计表: ListenAddr -> Set<RoutePath> */
  private routeAudit = new Map<string, Set<string>>();

  /** 受限制的 URL 模式（SSRF 防护等） */
  private restrictedPatterns: RestrictedPattern[] = [];

  constructor() {
    super();
  }

  /**
   * 获取全局单例
   */
  public static get instance(): RpcTransportManager {
    if (!this._serverInstance) {
      this._serverInstance = new RpcTransportManager();
    }
    return this._serverInstance;
  }

  /**
   * 注册已有的传输实例（服务端版：额外识别并管理服务端实例）
   */
  public register(transport: IToolTransport, apiUrl?: string) {
    const targetUrl = apiUrl || transport.apiUrl;
    if (targetUrl) {
      this.transports.set(targetUrl, transport);
    }
    if (this.isServer(transport)) {
      this.servers.add(transport);
    }
  }

  /**
   * 注册并管理服务端传输实例。
   * 会执行物理地址与逻辑路由的冲突审计。
   */
  public addServer(transport: IServerToolTransport, apiUrl?: string) {
    const targetUrl = apiUrl || transport.apiUrl;

    // 执行冲突审计
    const addrs = Array.isArray(transport.getListenAddr()) 
      ? transport.getListenAddr() as string[] 
      : [transport.getListenAddr() as string];
    const routes = transport.getRoutes();

    for (const addr of addrs) {
      if (!this.routeAudit.has(addr)) {
        this.routeAudit.set(addr, new Set());
      }
      const registeredRoutes = this.routeAudit.get(addr)!;
      for (const route of routes) {
        if (registeredRoutes.has(route)) {
          throw new Error(`Routing Conflict: Physical address "${addr}" already has a transport managing route "${route}"`);
        }
        registeredRoutes.add(route);
      }
    }

    this.register(transport, targetUrl);
  }

  /**
   * 启动所有托管的服务端传输实例
   */
  public async startAll(options?: any) {
    const promises = Array.from(this.servers).map(s => s.start(options));
    return Promise.all(promises);
  }

  /**
   * 停止所有托管的传输实例 (包括客户端连接池回收与服务端监听关闭)
   */
  public async stopAll(force?: boolean) {
    const serverPromises = Array.from(this.servers).map(s => s.stop(force));

    // 客户端实例如果有 stop 或 close 方法也一并执行
    const clientPromises = Array.from(this.transports.values())
      .filter(inst => !this.servers.has(inst as any))
      .map(inst => {
        if (typeof (inst as any).stop === 'function') return (inst as any).stop(force);
        if (typeof inst.close === 'function') return inst.close();
      });

    await Promise.all([...serverPromises, ...clientPromises]);
    this.transports.clear();
    this.servers.clear();
    this.routeAudit.clear();
  }

  /**
   * 动态添加受限模式
   */
  public addRestrictedPattern(pattern: RestrictedPattern | RestrictedPattern[]) {
    if (pattern && !Array.isArray(pattern)) { pattern = [pattern] }

    if (Array.isArray(pattern)) {
      pattern = pattern.map(p => isRegExpStr(p) ? toRegExp(p) : p)
      this.restrictedPatterns.push(...pattern);
    }
  }

  /**
   * 架构级策略校验 - 在请求进入调度器前执行
   * 默认执行 SSRF 防御校验。可通过继承并重写此方法来扩展自定义策略。
   *
   * @param request 归一化的 RPC 请求对象
   */
  public validateRpcRequest(request: ToolRpcRequest) {
    const url = request.apiUrl;
    if (isRestrictedPatterns(this.restrictedPatterns, url)) {
      throw new Error(`Access to restricted/local service is forbidden: ${url}`);
    }

    // 可以在此处添加更多默认的安全审计逻辑
  }

  private isServer(transport: any): transport is IServerToolTransport {
    return typeof transport.start === 'function' && typeof transport.stop === 'function';
  }
}

function isRestrictedPatterns(patterns: RestrictedPattern[], url: string) {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      if (url.includes(pattern)) { return true }
    } else if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}
