import { IToolTransport } from "./base";
import { IClientToolTransport } from "./client";
import { IServerToolTransport } from "./server";
import { ToolRpcRequest } from "./models";
import { isRegExpStr, toRegExp } from "util-ex";

type RestrictedPattern = string | RegExp;

/**
 * RPC 传输管理器 - 负责传输实例的生命周期、地址映射与策略校验
 */
export class RpcTransportManager {
  private static _instance: RpcTransportManager;

  /** 静态 Scheme 注册表: scheme -> Transport Class */
  private static schemeRegistry = new Map<string, any>();

  /** 动态 Scheme 解析器集合 */
  private static schemeResolvers: Array<(scheme: string) => any> = [];

  /** 实例缓存: apiUrl -> Transport Instance */
  private transports = new Map<string, IToolTransport>();

  /** 服务端传输实例集合 (用于闭环生命周期管理) */
  private servers = new Set<IServerToolTransport>();

  constructor() { }

  /**
   * 获取全局单例
   */
  public static get instance(): RpcTransportManager {
    if (!this._instance) {
      this._instance = new RpcTransportManager();
    }
    return this._instance;
  }

  /**
   * 绑定 URL Scheme 到具体的传输实现类
   * 
   * @param schemes - 单个或多个 Scheme (如 'http', 'wechat')，或动态解析器函数
   * @param transportClass - 当 schemes 为字符串或数组时对应的实现类
   */
  public static bindScheme(
    schemes: string | string[] | ((scheme: string) => any),
    transportClass?: any
  ) {
    if (typeof schemes === 'function') {
      this.schemeResolvers.push(schemes);
    } else {
      const schemeList = Array.isArray(schemes) ? schemes : [schemes];
      for (const scheme of schemeList) {
        this.schemeRegistry.set(scheme.toLowerCase(), transportClass);
      }
    }
  }

  /**
   * @deprecated 使用 bindScheme 代替
   */
  public static registerProtocol(scheme: string, transportClass: any) {
    this.bindScheme(scheme, transportClass);
  }

  /**
   * 注册已有的传输实例
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
   * 获取或创建客户端传输实例
   */
  public getClient(apiUrl: string, options?: any): IClientToolTransport {
    if (this.transports.has(apiUrl)) {
      return this.transports.get(apiUrl) as IClientToolTransport;
    }

    const url = new URL(apiUrl);
    const scheme = url.protocol.replace(':', '').toLowerCase();
    
    // 1. 尝试从静态注册表查找
    let TransportClass = RpcTransportManager.schemeRegistry.get(scheme);

    // 2. 尝试从动态解析器查找
    if (!TransportClass && RpcTransportManager.schemeResolvers.length > 0) {
      for (const resolver of RpcTransportManager.schemeResolvers) {
        try {
          TransportClass = resolver(scheme);
          if (TransportClass) {
            // 自动加入缓存，优化下次查找
            RpcTransportManager.schemeRegistry.set(scheme, TransportClass);
            break;
          }
        } catch (err) {
          // 忽略单个解析器的异常，继续尝试下一个
          console.warn(`RpcTransportManager: Resolver error for scheme "${scheme}":`, err);
        }
      }
    }

    if (!TransportClass) {
      throw new Error(`Unsupported URL scheme: ${scheme}. Use RpcTransportManager.bindScheme to register it.`);
    }

    const instance = new TransportClass(apiUrl, options);
    this.register(instance, apiUrl);
    return instance;
  }

  /**
   * 注册并管理服务端传输实例
   */
  public addServer(transport: IServerToolTransport, apiUrl?: string) {
    this.register(transport, apiUrl);
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
        if (typeof inst.stop === 'function') return inst.stop(force);
        if (typeof inst.close === 'function') return inst.close();
      });

    await Promise.all([...serverPromises, ...clientPromises]);
    this.transports.clear();
    this.servers.clear();
  }

  /** 受限制的 URL 模式（SSRF 防护等） */
  private restrictedPatterns: RestrictedPattern[] = [];

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
