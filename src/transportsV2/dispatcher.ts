import { RpcActiveTaskTracker, RpcActiveTaskHandle } from './task-tracker';
import { 
  RPC_HEADERS, 
  RPC_DEFAULTS, 
  RpcStatusCode, 
  ToolRpcRequest, 
  ToolRpcResponse, 
  ToolRpcContext,
  RpcError
} from './models';
import { RpcDeadlineGuard } from './deadline-guard';
import { bridgeV2RequestToV1Params, elevateV1ParamsToV2Request, RpcCompatOptions, DEFAULT_COMPAT_OPTIONS } from './compat';
import { RpcTaskResource } from './rpc-task';
import { randomUUID } from 'crypto';

/**
 * 集中式 RPC 请求分发器。
 * 负责将标准化的 ToolRpcRequest 路由到注册表中的工具函数。
 */
export class RpcServerDispatcher {
  private static _instance: RpcServerDispatcher;
  /** 工具/函数注册表，通常挂载 ServerTools.items */
  public registry: any;
  /** 系统级保留工具注册表 */
  private systemRegistry = new Map<string, any>();
  /** 活动任务跟踪器，用于长任务状态管理 */
  public tracker: RpcActiveTaskTracker;
  /** 默认全局超时时间 (ms) */
  public globalTimeout: number = 30000;
  /** 兼容性配置 */
  public compat: RpcCompatOptions = DEFAULT_COMPAT_OPTIONS;

  constructor(options?: {
    registry?: any,
    tracker?: RpcActiveTaskTracker,
    globalTimeout?: number,
    compat?: RpcCompatOptions
  }) {
    this.registry = options?.registry;
    this.tracker = options?.tracker || new RpcActiveTaskTracker();
    if (options?.globalTimeout) this.globalTimeout = options.globalTimeout;
    if (options?.compat) this.compat = { ...DEFAULT_COMPAT_OPTIONS, ...options.compat };
    
    // 自动装载系统级工具
    this.systemRegistry.set('rpcTask', new RpcTaskResource());
  }

  public static get instance() {
    if (!this._instance) this._instance = new RpcServerDispatcher();
    return this._instance;
  }

  /**
   * 分发请求。
   * @param request 归一化的 RPC 请求对象
   * @param registry 可选的替代注册表 (用于多路由挂载场景)
   */
  public async dispatch(request: ToolRpcRequest, registry?: any): Promise<ToolRpcResponse> {
    try {
      // 1. [寻址阶段]：查找工具、预检能力、桥接参数
      const { tool, params } = this.resolveTool(request, registry);

      // 2. [准备阶段]：生成 Context、Aborter 和超时配置
      const { context, abortController, timeoutConfig } = this.prepareContext(request, tool, params);

      // 3. [执行阶段]：调用工具函数获取 Promise
      const executionPromise = this.performExecution(tool, params, context);

      // 4. [注册阶段]：立即登记到 Tracker，确保从执行那一刻起全链路可见
      this.trackTask(request.requestId, executionPromise, abortController, tool, params, context);

      // 5. [等待阶段]：处理执行结果与死线控制 (包含 102 处理)
      const response = await this.waitForResult(request, executionPromise, abortController, timeoutConfig);
      
      // [即时清理] 若任务已完成且策略是不保留，则立即从账本移除
      this.checkImmediateCleanup(request.requestId);
      
      return response;

    } catch (err: any) {
      this.checkImmediateCleanup(request.requestId);
      return this.echoRequestId(request, this.handleError(request, err));
    }
  }

  /**
   * 检查是否需要立即回收账本资源
   */
  private checkImmediateCleanup(requestId: string) {
    const handle = this.tracker.get(requestId);
    if (handle && handle.shouldCleanup(Date.now())) {
      this.tracker.remove(requestId);
    }
  }

  /**
   * [寻址阶段] 查找工具并准备参数
   */
  private resolveTool(request: ToolRpcRequest, registry?: any) {
    // 1. [规范化] 从 Header 提取核心路由信息 (如果 Request 属性中没有)
    if (!request.act && request.headers[RPC_HEADERS.ACT]) {
      request.act = String(request.headers[RPC_HEADERS.ACT]);
    }
    if (!request.resId && request.headers[RPC_HEADERS.RES_ID]) {
      request.resId = String(request.headers[RPC_HEADERS.RES_ID]);
    }

    // 2. [兼容层] 向上提升路由信息 (从 params 中提取)
    if (this.compat.enableParamBridge) {
      elevateV1ParamsToV2Request(request);
    }

    const targetRegistry = registry || this.registry;
    const { toolId } = request;
    
    let tool;
    if (targetRegistry) {
      tool = targetRegistry.get ? targetRegistry.get(toolId) : targetRegistry[toolId];
    }
    if (!tool) {
      tool = this.systemRegistry.get(toolId);
    }

    if (!tool) {
      if (!targetRegistry) {
        throw new RpcError("Dispatcher Registry not mounted", RpcStatusCode.INTERNAL_ERROR);
      }
      throw new RpcError(`Tool not found: ${toolId}`, RpcStatusCode.NOT_FOUND);
    }

    if (request.params?.stream && !tool.stream) {
      throw new RpcError(`Streaming not supported by tool: ${toolId}`, RpcStatusCode.BAD_REQUEST);
    }

    const params = this.compat.enableParamBridge
      ? bridgeV2RequestToV1Params(request, { ...request.params })
      : (request.params || {});

    return { tool, params };
  }

  /**
   * [准备阶段] 构建执行上下文与超时策略
   */
  private prepareContext(request: ToolRpcRequest, tool: any, params: any) {
    const clientTimeout = request.headers[RPC_HEADERS.TIMEOUT] ? parseInt(request.headers[RPC_HEADERS.TIMEOUT] as string) : undefined;
    const toolTimeoutObj = typeof tool.timeout === 'object' ? tool.timeout : { value: tool.timeout };
    const finalTimeout = clientTimeout || toolTimeoutObj.value || this.globalTimeout;

    const abortController = new AbortController();

    const context: ToolRpcContext = {
      requestId: request.requestId,
      traceId: request.traceId || (request.headers[RPC_HEADERS.TRACE_ID] as string) || randomUUID(),
      headers: request.headers,
      signal: abortController.signal,
      dispatcher: this,
      resId: request.resId,
      act: request.act,
      req: request.raw?._req || request.raw,
      reply: request.raw?._res
    };

    return {
      context,
      abortController,
      timeoutConfig: {
        finalTimeout,
        keepAliveOnTimeout: !!toolTimeoutObj.keepAliveOnTimeout
      }
    };
  }

  /**
   * [执行阶段] 触发业务逻辑
   */
  private performExecution(tool: any, params: any, context: ToolRpcContext): Promise<any> {
    (tool as any).ctx = context;
    try {
      return Promise.resolve(tool.run ? tool.run(params, context) : tool(params, context));
    } catch (syncError) {
      return Promise.reject(syncError);
    }
  }

  /**
   * [注册阶段] 向账本登记任务
   */
  private trackTask(
    requestId: string, 
    promise: Promise<any>, 
    aborter: AbortController, 
    tool: any, 
    params: any, 
    context: ToolRpcContext
  ) {
    const handle = new RpcActiveTaskHandle(
      requestId,
      promise,
      aborter,
      !!tool.stream,
      () => { if (tool.cleanup) tool.cleanup(params, context); },
      tool.retention
    );
    this.tracker.add(requestId, handle);
  }

  /**
   * [等待阶段] 决定如何响应客户端 (同步等待还是转入后台)
   */
  private async waitForResult(
    request: ToolRpcRequest, 
    promise: Promise<any>, 
    aborter: AbortController, 
    config: { finalTimeout: number; keepAliveOnTimeout: boolean }
  ): Promise<ToolRpcResponse> {
    const { finalTimeout, keepAliveOnTimeout } = config;

    if (keepAliveOnTimeout) {
      const guard = new RpcDeadlineGuard(finalTimeout, { onResponseTimeout: () => { } });
      try {
        const result = await Promise.race([promise, guard.getPromise()]);
        guard.cancel();
        return this.echoRequestId(request, this.normalizeResult(result));
      } catch (err: any) {
        if (err.code === RpcStatusCode.PROCESSING) {
          return this.handle102(request);
        }
        throw err;
      }
    } else {
      try {
        const result = await this.wrapWithSignal(promise, aborter.signal, finalTimeout);
        return this.echoRequestId(request, this.normalizeResult(result));
      } catch (err: any) {
        // [关键修复]：如果是硬超时，必须中止控制器以更新 Handle 状态并允许清理
        if (err.code === RpcStatusCode.TERMINATED) {
           aborter.abort(err);
        }
        throw err;
      }
    }
  }

  private handle102(request: ToolRpcRequest): ToolRpcResponse {
    return this.echoRequestId(request, {
      status: RpcStatusCode.PROCESSING,
      headers: {
        [RPC_HEADERS.RETRY_AFTER]: RPC_DEFAULTS.RETRY_AFTER_MS,
        [RPC_HEADERS.REQUEST_ID]: request.requestId
      },
      data: { status: 102, message: "Task moved to background" }
    });
  }

  private echoRequestId(request: ToolRpcRequest, response: ToolRpcResponse): ToolRpcResponse {
    if (!response.headers) response.headers = {};
    response.headers[RPC_HEADERS.REQUEST_ID] = request.requestId;
    return response;
  }

  private wrapWithSignal<T>(promise: Promise<T>, signal: AbortSignal, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err: any = new Error('Request Timeout');
        err.name = 'AbortError';
        err.code = RpcStatusCode.TERMINATED;
        reject(err);
      }, timeout);

      const onAbort = () => {
        clearTimeout(timer);
        const err: any = new Error('Operation Aborted');
        err.name = 'AbortError';
        err.code = RpcStatusCode.TERMINATED;
        reject(err);
      };

      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });

      promise.then(
        res => { 
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort); 
          resolve(res); 
        },
        err => { 
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort); 
          reject(err); 
        }
      );
    });
  }

  private normalizeResult(result: any): ToolRpcResponse {
    if (result && typeof result === 'object' && result.status !== undefined && (result.data !== undefined || result.error !== undefined)) {
      return result;
    }
    return { status: RpcStatusCode.OK, data: result };
  }

  public handleError(request: ToolRpcRequest, err: any): ToolRpcResponse {
    if (typeof err !== 'object' || err === null) {
      return {
        status: 500,
        error: { code: 500, status: 'error', message: String(err) }
      };
    }

    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.code === 20 || err.code === RpcStatusCode.TERMINATED) {
      return {
        status: RpcStatusCode.TERMINATED,
        error: { code: 408, status: 'timeout', message: err.message || "Request Timeout" }
      };
    }

    if (err.status === RpcStatusCode.PROCESSING || err.code === RpcStatusCode.PROCESSING) {
      return {
        status: RpcStatusCode.PROCESSING,
        data: { code: 102, status: 'processing', message: err.message || "Processing" }
      };
    }

    if (err.status === RpcStatusCode.CONFLICT || err.code === RpcStatusCode.CONFLICT) {
      return {
        status: RpcStatusCode.CONFLICT,
        error: { code: 409, status: 'conflict', message: err.message || "Request ID Conflict" }
      };
    }

    const rawCode = err.code || (typeof err.status === 'number' ? err.status : undefined);
    const errCode = typeof rawCode === 'number' ? rawCode : 500;

    let errStatus: string | undefined = undefined;
    if (typeof err.status === 'string') {
      errStatus = err.status;
    } else if (errCode === 404) {
      errStatus = 'not_found';
    } else if (errCode === 400) {
      errStatus = 'bad_request';
    } else if (errCode === 409) {
      errStatus = 'conflict';
    }

    return {
      status: (errCode >= 400 && errCode < 600) ? errCode : 500,
      error: { code: errCode, status: errStatus, message: err.message || String(err), data: err.data }
    };
  }
}
