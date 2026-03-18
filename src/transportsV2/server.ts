import { defaultsDeep } from 'lodash-es';
import { ToolTransport, type IToolTransport, type ToolTransportOptions } from './base';
import { RpcServerDispatcher } from './dispatcher';
import { ToolRpcRequest, ToolRpcResponse } from './models';

export interface ServerToolTransportOptions extends ToolTransportOptions {
  dispatcher?: RpcServerDispatcher;
}

export interface IServerToolTransport extends IToolTransport {
  dispatcher: RpcServerDispatcher;

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

  constructor(options?: ServerToolTransportOptions) {
    super(options);
    this.dispatcher = options?.dispatcher || RpcServerDispatcher.instance;
  }

  public getListenAddr(): string | string[] {
    return this.apiUrl;
  }

  public getRoutes(): string[] {
    return ['/'];
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
      const rpcReq = await this.toRpcRequest(rawReq);

      // 架构层校验：调用所属 Manager 实例进行策略审计 (SSRF 防御、白名单等)
      this.manager.validateRpcRequest(rpcReq);

      const rpcRes = await this.dispatcher.dispatch(rpcReq, registry);
      await this.sendRpcResponse(rpcRes, rawRes);
    } catch (err: any) {
      // 顶级异常防护 (Top-level pipeline guard)
      const rawCode = err.code || (typeof err.status === 'number' ? err.status : undefined);
      const errCode = typeof rawCode === 'number' ? rawCode : 500;
      const errStatus = typeof err.status === 'string' ? err.status : 'error';

      await this.sendRpcResponse({
        status: (errCode >= 400 && errCode < 600) ? errCode : 500,
        error: {
          message: err.message || "Transport Pipeline Error",
          code: errCode,
          status: errStatus,
          data: err.data
        }
      }, rawRes);
    }
  }

  protected abstract toRpcRequest(rawReq: any): Promise<ToolRpcRequest>;
  protected abstract sendRpcResponse(rpcRes: ToolRpcResponse, rawRes: any): Promise<void>;

  public abstract addDiscoveryHandler(apiUrl: string, handler: () => any): void;
  public abstract addRpcHandler(apiUrl: string, options?: any): void;
  public abstract _start(options?: any): Promise<any>;
  public abstract stop(force?: boolean): Promise<void>;
  public getRaw?(): any;
}
