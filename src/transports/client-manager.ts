import type { IToolTransport } from "./base";
import type { IClientToolTransport } from "./client";

/**
 * RPC 客户端传输管理器 - 浏览器友好版本
 * 负责传输实例的注册、地址映射和方案解析。
 * 不包含任何服务端相关的逻辑（servers, routeAudit, validateRpcRequest 等）。
 */
export class RpcClientTransportManager {
  private static _instance: RpcClientTransportManager;

  /** 静态 Scheme 注册表: scheme -> Transport Class */
  private static schemeRegistry = new Map<string, any>();

  /** 动态 Scheme 解析器集合 */
  private static schemeResolvers: Array<(scheme: string) => any> = [];

  /** 实例缓存: apiUrl -> Transport Instance */
  protected transports = new Map<string, IToolTransport>();

  constructor() { }

  /**
   * 获取全局单例
   */
  public static get instance(): RpcClientTransportManager {
    if (!this._instance) {
      this._instance = new RpcClientTransportManager();
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
   * 清空所有静态注册的 Schemes (主要用于测试清理)
   * @param scheme - 可选，仅清除指定 scheme
   */
  public static clearSchemes(scheme?: string) {
    if (scheme) {
      RpcClientTransportManager.schemeRegistry.delete(scheme.toLowerCase());
      // Note: Resolvers cannot be cleared selectively by scheme string easily as they are functions
    } else {
      RpcClientTransportManager.schemeRegistry.clear();
      RpcClientTransportManager.schemeResolvers = [];
    }
  }

  /**
   * 注册已有的传输实例
   */
  public register(transport: IToolTransport, apiUrl?: string) {
    const targetUrl = apiUrl || transport.apiUrl;
    if (targetUrl) {
      this.transports.set(targetUrl, transport);
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
    let TransportClass = RpcClientTransportManager.schemeRegistry.get(scheme);

    // 2. 尝试从动态解析器查找
    if (!TransportClass && RpcClientTransportManager.schemeResolvers.length > 0) {
      for (const resolver of RpcClientTransportManager.schemeResolvers) {
        try {
          TransportClass = resolver(scheme);
          if (TransportClass) {
            // 自动加入缓存，优化下次查找
            RpcClientTransportManager.schemeRegistry.set(scheme, TransportClass);
            break;
          }
        } catch (err) {
          // 忽略单个解析器的异常，继续尝试下一个
          console.warn(`RpcClientTransportManager: Resolver error for scheme "${scheme}":`, err);
        }
      }
    }

    if (!TransportClass) {
      throw new Error(`Unsupported URL scheme: ${scheme}. Use bindScheme to register it.`);
    }

    const instance = new TransportClass(apiUrl, options);
    this.register(instance, apiUrl);
    return instance;
  }

  /**
   * 架构级策略校验 - 基类提供空实现，子类可重写
   */
  public validateRpcRequest(request: any) {
    // Base implementation: no-op for client-side
    // Subclasses (RpcTransportManager) can override for SSRF protection
  }

  /**
   * 动态添加受限模式 - 基类提供空实现
   */
  public addRestrictedPattern(pattern: any) {
    // Base implementation: no-op for client-side
    // Subclasses can override for SSRF protection
  }

  /**
   * 停止所有托管的传输实例 (仅清理客户端缓存)
   */
  public async stopAll(force?: boolean) {
    const clientPromises = Array.from(this.transports.values()).map(inst => {
      if (typeof (inst as any).stop === 'function') return (inst as any).stop(force);
      if (typeof inst.close === 'function') return inst.close();
    });

    await Promise.all(clientPromises);
    this.transports.clear();
  }
}
