import { IToolTransport } from "./base";
import { IServerToolTransport } from "./server";
import { ToolRpcRequest } from "./models";
import { isRegExpStr, toRegExp } from "util-ex";
import { RpcClientTransportManager } from "./client-manager";

type RestrictedPattern = string | RegExp;

/**
 * RPC 传输管理器（服务端完整版）
 * 继承了 RpcClientTransportManager 的客户端能力，额外增加了服务端生命周期管理、
 * 路由归属登记和 SSRF 防护。
 * 
 * 在 Node.js 环境中使用此类以保持完全的向后兼容。
 */
export class RpcTransportManager extends RpcClientTransportManager {
  private static _serverInstance: RpcTransportManager;

  /** 服务端传输实例集合 (用于闭环生命周期管理) */
  private servers = new Set<IServerToolTransport>();

  /**
   * 路由归属表：native address（声明身份）-> 该底座上已被占用的 Set<RoutePath>。
   * 作用是在共享物理端口上挡住重复注册同一路由（路由劫持）。
   */
  private routeOwnership = new Map<string, Set<string>>();

  /**
   * 每个服务端实例登记了什么（地址 + 路由），用于 stop 时注销、bind 改写后迁移。
   * 不记的话：同一个 transport 停掉再上同一路由会永远报 Routing Conflict。
   */
  private serverRegistrations = new WeakMap<IServerToolTransport, Array<{ addr: string, routes: string[] }>>();

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
   * 注册并管理服务端传输实例（登记到路由归属表 + 转给 `register()`）。
   * 会检查声明身份与逻辑路由是否已被别人占（撞了抛 `Routing Conflict`）。
   *
   * key 就是 transport 自报的地址（`getListenAddr()`），**不透明字符串直接相等**：
   * 同一个 key 就是同一个底座。Manager 不解析、不校验、不规范化地址。
   * 不再做包含关系合并（以前 `samePhysicalBase` 判定通配覆盖具体 host）：那个关系
   * 非传递（A~B、A~C 却 B!~C），先把 A 归入 B 桶后 C 就再也看不到 A → 漏报；
   * 又把两个不同 host 塌成一个底座 → 误报。真撞了内核会报 EADDRINUSE，fail fast。
   */
  public registerServer(transport: IServerToolTransport, apiUrl?: string) {
    // transport 在 start/stop 时通过自己的 `manager` 回调迁移与注销归属登记。
    // 不把它指向接管本实例的 manager，那些信号就会发到全局单例，
    // 本 manager 的归属表永远对不上（实测：stop 后同一路由永久报冲突）。
    const owned = transport as any;
    if (owned.manager !== this) {owned.manager = this;}
    this.registerServerRoutes(transport);
    this.register(transport, apiUrl || transport.apiUrl);
  }

  /**
   * @deprecated 用 {@link registerServer}。`add` 的反义词不是 `release`，这一对动词本来就不
   * 成对；`registerServer` / `unregisterServer` 与 transport 侧的 `registerRoutes` /
   * `unregisterRoutes` 同族。已发布过，所以保留一个版本的转发窗口。
   */
  public addServer(transport: IServerToolTransport, apiUrl?: string) {
    return this.registerServer(transport, apiUrl);
  }

  /**
   * 登记一个服务端实例的路由声明：先查冲突，再记下它占的条目。
   * 失败时不留下部分写入（否则抛错后该前缀永久占位）。
   */
  private registerServerRoutes(transport: IServerToolTransport): void {
    // key = transport 自报的地址；框架不解析、不校验（地址语义归 transport 自己）
    const declared = transport.getListenAddr();
    const addrs = Array.isArray(declared) ? declared : [declared];
    const routes = transport.getRoutes();

    const entries: Array<{ addr: string, routes: string[] }> = [];
    for (const addr of addrs) {
      const registeredRoutes = this.routeOwnership.get(addr);
      if (registeredRoutes) {
        for (const route of routes) {
          if (registeredRoutes.has(route)) {
            throw new Error(`Routing Conflict: "${addr}" already has a transport managing route "${route}"`);
          }
        }
      }
      entries.push({ addr, routes: [...routes] });
    }

    for (const { addr, routes: owned } of entries) {
      const bucket = this.routeOwnership.get(addr) ?? new Set<string>();
      this.routeOwnership.set(addr, bucket);
      for (const route of owned) {bucket.add(route);}
    }
    this.serverRegistrations.set(transport, entries);
  }

  /**
   * 注销一个服务端实例登记的路由归属（stop 时由 transport 调用）。
   * 空桶一并删掉，否则归属表只长不消。
   */
  public unregisterServer(transport: IServerToolTransport): void {
    const entries = this.serverRegistrations.get(transport);
    if (!entries) {return;}
    this.serverRegistrations.delete(transport);
    for (const { addr, routes } of entries) {
      const bucket = this.routeOwnership.get(addr);
      if (!bucket) {continue;}
      for (const route of routes) {bucket.delete(route);}
      if (bucket.size === 0) {this.routeOwnership.delete(addr);}
    }
  }

  /**
   * 地址变了（`start({ port })` 改写、port 0 观测到真实端口）后按当前地址重登归属。
   * 不重登就会把登记停在旧地址上：对真实底座漏报、对让出去的地址过报冲突。
   * 新 key 上已有别人占同一前缀时同样报冲突（此时还没监听，比 EADDRINUSE 先一步）。
   */
  public refreshServerRegistration(transport: IServerToolTransport): void {
    if (!this.serverRegistrations.has(transport)) {return;}   // 没走 registerServer 的实例不管
    const previous = this.serverRegistrations.get(transport)!;
    this.unregisterServer(transport);
    try {
      this.registerServerRoutes(transport);
    } catch (err) {
      // 登记失败不能把该实例的路由静默抹掉：回退到旧条目再报错
      this.serverRegistrations.set(transport, previous);
      for (const { addr, routes } of previous) {
        const bucket = this.routeOwnership.get(addr) ?? new Set<string>();
        this.routeOwnership.set(addr, bucket);
        for (const route of routes) {bucket.add(route);}
      }
      throw err;
    }
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
    this.routeOwnership.clear();
    this.serverRegistrations = new WeakMap();
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
