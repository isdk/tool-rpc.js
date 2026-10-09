import { IToolTransport } from "./base";
import { IServerToolTransport } from "./server";
import { samePhysicalBase } from "./physical-uri";
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

    // 执行冲突审计（key = 声明身份；旧名 getListenAddr 仅作兼容回落）
    const declared = transport.getBaseUrl?.() ?? transport.getListenAddr();
    const addrs = Array.isArray(declared)
      ? declared as string[]
      : [declared as string];
    const routes = transport.getRoutes();

    for (const addr of addrs) {
      // 归入已有同一物理底座的审计桶（通配 authority 包含具体 host），否则新建
      const bucketKey = this.findAuditBucket(addr) ?? addr;
      if (!this.routeAudit.has(bucketKey)) {
        this.routeAudit.set(bucketKey, new Set());
      }
      const registeredRoutes = this.routeAudit.get(bucketKey)!;
      for (const route of routes) {
        if (registeredRoutes.has(route)) {
          const base = bucketKey === addr
            ? `"${addr}"`
            : `"${bucketKey}" (covers "${addr}")`;
          throw new Error(`Routing Conflict: Physical address ${base} already has a transport managing route "${route}"`);
        }
        registeredRoutes.add(route);
      }
    }

    this.register(transport, targetUrl);
  }

  /**
   * 找到与 addr 指向同一物理底座的已有审计桶。
   * 依据实测：`0.0.0.0:3000` 与 `localhost:3000` 在两个方向上都 EADDRINUSE，
   * 所以必须当作同一底座；而两个不同具体 host 同端口可共存，不能塌缩。
   */
  private findAuditBucket(addr: string): string | undefined {
    for (const key of this.routeAudit.keys()) {
      if (samePhysicalBase(key, addr)) {return key;}
    }
    return undefined;
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
