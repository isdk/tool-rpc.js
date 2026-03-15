import { RpcActiveTaskTracker, ActiveTaskHandle } from './task-tracker';
import { RPC_HEADERS, RPC_DEFAULTS, RpcStatusCode, ToolRpcRequest, ToolRpcResponse, ToolRpcContext } from './models';
import { RpcDeadlineGuard } from './deadline-guard';
import { bridgeV2RequestToV1Params, elevateV1ParamsToV2Request, RpcCompatOptions, DEFAULT_COMPAT_OPTIONS } from './compat';
import { RpcTaskResource } from './rpc-task';

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
    // [兼容层] 向上提升路由信息：如果开启桥接，先将写在 params 内部的 id/act 提升到 Request 属性中
    if (this.compat.enableParamBridge) {
      elevateV1ParamsToV2Request(request);
    }

    const targetRegistry = registry || this.registry;
    const { toolId } = request;
    
    let tool;
    
    // 1. 优先尝试从用户注册表中查找 (User Override)
    if (targetRegistry) {
      tool = targetRegistry.get ? targetRegistry.get(toolId) : targetRegistry[toolId];
    }

    // 2. 如果没找到，尝试从系统注册表中查找 (System Fallback)
    if (!tool) {
      tool = this.systemRegistry.get(toolId);
    }

    if (!tool) {
      if (!targetRegistry) {
         return this.echoRequestId(request, {
          status: RpcStatusCode.INTERNAL_ERROR,
          error: { code: 500, status: 'error', message: "Dispatcher Registry not mounted" }
        });
      }
      return this.echoRequestId(request, {
        status: RpcStatusCode.NOT_FOUND,
        error: { code: 404, status: 'not_found', message: `Tool not found: ${toolId}` }
      });
    }

    // 3. 协议校验 (新架构强制校验能力匹配)
    if (request.params?.stream && !tool.stream) {
      return this.echoRequestId(request, {
        status: RpcStatusCode.BAD_REQUEST,
        error: { code: 400, status: 'bad_request', message: `Streaming not supported by tool: ${toolId}` }
      });
    }

    // 2. 超时协商
    const clientTimeout = request.headers[RPC_HEADERS.TIMEOUT] ? parseInt(request.headers[RPC_HEADERS.TIMEOUT] as string) : undefined;
    const toolTimeoutObj = typeof tool.timeout === 'object' ? tool.timeout : { value: tool.timeout };
    const finalTimeout = clientTimeout || toolTimeoutObj.value || this.globalTimeout;

    const abortController = new AbortController();
    const autoTerminateTimer = setTimeout(() => abortController.abort(), finalTimeout);

    // 3. 构造 V2 Context (此时 request.id/act 已可能是提升后的值)
    const context: ToolRpcContext = {
      requestId: request.requestId,
      traceId: request.traceId || (request.headers[RPC_HEADERS.TRACE_ID] as string),
      headers: request.headers,
      signal: abortController.signal,
      dispatcher: this,
      resId: request.resId,
      act: request.act,
      req: request.raw?._req || request.raw,
      reply: request.raw?._res
    };

    // 4. [兼容层] 向下灌注参数 (保持 V1 工具函数逻辑不碎裂)
    const executionParams = this.compat.enableParamBridge
      ? bridgeV2RequestToV1Params(request, { ...request.params })
      : (request.params || {});

    // 5. 执行工具
    (tool as any).ctx = context;
    
    let executionPromise: Promise<any>;

    try {
      try {
        executionPromise = Promise.resolve(tool.run ? tool.run(executionParams, context) : tool(executionParams, context));
      } catch (syncError) {
        executionPromise = Promise.reject(syncError);
      }

      let result: any;
      if (toolTimeoutObj.keepAliveOnTimeout) {
        const guard = new RpcDeadlineGuard(finalTimeout, { onResponseTimeout: () => { } });
        result = await Promise.race([executionPromise, guard.getPromise()]);
        guard.cancel();
      } else {
        result = await this.wrapWithSignal(executionPromise, abortController.signal);
      }

      clearTimeout(autoTerminateTimer);
      return this.echoRequestId(request, this.normalizeResult(result));

    } catch (err: any) {
      clearTimeout(autoTerminateTimer);
      if (err.code === 102 && toolTimeoutObj.keepAliveOnTimeout) {
        // If executionPromise failed with 102, we might not have a promise to track if it was sync throw?
        // Actually sync throw of 102 is rare but possible.
        // However, for async 102 (long running), we need the original promise.
        
        // Ensure we have a valid promise for the tracker
        if (!executionPromise!) {
             executionPromise = Promise.reject(err);
        }

        const handle = new ActiveTaskHandle(
          request.requestId,
          executionPromise,
          abortController,
          !!tool.stream,
          () => { if (tool.cleanup) tool.cleanup(executionParams, context); }
        );
        this.tracker.add(request.requestId, handle);
        return this.echoRequestId(request, {
          status: RpcStatusCode.PROCESSING,
          headers: {
            [RPC_HEADERS.RETRY_AFTER]: RPC_DEFAULTS.RETRY_AFTER_MS,
            [RPC_HEADERS.REQUEST_ID]: request.requestId
          },
          data: { status: 102, message: "Task moved to background" }
        });
      }
      return this.echoRequestId(request, this.handleError(request, err));
    }
  }

  private echoRequestId(request: ToolRpcRequest, response: ToolRpcResponse): ToolRpcResponse {
    if (!response.headers) response.headers = {};
    response.headers[RPC_HEADERS.REQUEST_ID] = request.requestId;
    return response;
  }

  private wrapWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const err: any = new Error('Request Timeout');
        err.name = 'AbortError';
        err.code = 408;
        reject(err);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        res => { signal.removeEventListener('abort', onAbort); resolve(res); },
        err => { signal.removeEventListener('abort', onAbort); reject(err); }
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
    // 1. Handle primitive errors (string, number, etc)
    if (typeof err !== 'object' || err === null) {
      return {
        status: 500,
        error: { code: 500, status: 'error', message: String(err) }
      };
    }

    // 2. Handle standard Error objects and duck-typed errors
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.code === 20 || err.code === 408) {
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

    const rawCode = err.code || (typeof err.status === 'number' ? err.status : undefined);
    const errCode = typeof rawCode === 'number' ? rawCode : 500;

    let errStatus: string | undefined = undefined;
    if (typeof err.status === 'string') {
      errStatus = err.status;
    } else if (errCode === 404) {
      errStatus = 'not_found';
    } else if (errCode === 400) {
      errStatus = 'bad_request';
    }

    return {
      status: (errCode >= 400 && errCode < 600) ? errCode : 500,
      error: { code: errCode, status: errStatus, message: err.message || String(err), data: err.data }
    };
  }
}
