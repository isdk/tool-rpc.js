import { RpcClientTransportManager } from "./client-manager";

/**
 * 通用的 RPC 处理函数句柄类型
 */
export type RpcMethodHandler = (params: any, context?: any) => Promise<any> | any;


export interface ToolTransportOptions {
  manager?: RpcClientTransportManager;
  apiUrl?: string;
  [key: string]: any;
}

/**
 * 所有传输协议 (Client/Server) 统一的基础能力接口。
 */
export interface IToolTransport {
  /**
   * 所属管理器引用
   */
  manager?: RpcClientTransportManager;

  /**
   * 调用的基准 API 地点（URI）
   * 必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
   * 对于扁平协议，不必支持 path 路由（具体通过 header 进行）。
   */
  apiUrl: string;

  /**
   * 具体协议额外的配置或选项扩展
   */
  options?: ToolTransportOptions;

  /**
   * 启动服务 (仅服务端有效)
   */
  start?(options?: any): Promise<any>;

  /**
   * 停止服务或回收资源
   */
  stop?(force?: boolean): Promise<void>;

  /**
   * 物理层关闭句柄 (可选)
   */
  close?(): Promise<void> | void;

  [name: string]: any;
}

export abstract class ToolTransport implements IToolTransport {
  declare apiUrl: string;
  declare options?: ToolTransportOptions;
  public manager: RpcClientTransportManager;

  constructor(options?: ToolTransportOptions) {
    // **存副本，别存引用**：调用方传进来的 options 随后会被超时协商就地改写
    // （`timeout` 变成 `{ value }`、`headers` 上塞 `rpc-timeout`/`req-id`）。
    // 而 transport 实例是按 apiUrl 缓存的（`RpcClientTransportManager.getClient`），
    // 引用一旦被存下来，"本次调用"的 timeout / 凭证就成了这个地址后续所有调用的默认值——
    // 上一个调用方的 Bearer 会串到下一个调用方身上（见 test/per-call-options-isolation.test.ts）。
    // 嵌套的 `timeout` / `headers` 由 `ClientToolTransport.fetch()` 那边负责复制。
    this.options = options ? { ...options } : options;
    this.manager = options?.manager || RpcClientTransportManager.instance;
    if (options?.apiUrl) {
      this.apiUrl = options.apiUrl;
    }
  }

  public setApiUrl(apiUrl: string) {
    this.apiUrl = apiUrl;
  }
}
