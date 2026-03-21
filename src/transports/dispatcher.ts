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
import { createCallbacksTransformer } from '@isdk/tool-func';

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
  /** 硬超时后的清理宽限期 (ms) */
  public terminationGraceMs: number = RPC_DEFAULTS.TERMINATION_GRACE_MS;
  /** 全局任务执行硬死线 (ms)，防止后台任务永久运行。默认 1 小时 */
  public maxTaskRuntimeMs: number = 3600000;

  constructor(options?: {
    registry?: any,
    tracker?: RpcActiveTaskTracker,
    globalTimeout?: number,
    compat?: RpcCompatOptions,
    terminationGraceMs?: number,
    maxTaskRuntimeMs?: number
  }) {
    this.registry = options?.registry;
    this.tracker = options?.tracker || new RpcActiveTaskTracker();
    if (options?.globalTimeout) this.globalTimeout = options.globalTimeout;
    if (options?.compat) this.compat = { ...DEFAULT_COMPAT_OPTIONS, ...options.compat };
    if (options?.terminationGraceMs !== undefined) this.terminationGraceMs = options.terminationGraceMs;
    if (options?.maxTaskRuntimeMs !== undefined) this.maxTaskRuntimeMs = options.maxTaskRuntimeMs;

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
    // 利用 tool-func 的影子实例机制隔离上下文，防止并发冲突
    const runner = (typeof tool.with === 'function') ? tool.with(context) : tool;

    try {
      return Promise.resolve(runner.run ? runner.run(params, context) : runner(params, context));
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
      tool.retention,
      this.maxTaskRuntimeMs
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

    // 根据工具配置决定死线策略：
    // - 开启 keepAlive: finalTimeout 作为软超时 (触发 102)
    // - 未开启 keepAlive: finalTimeout 作为硬超时 (触发 408 并中止)
    const guard = new RpcDeadlineGuard(
      keepAliveOnTimeout ? finalTimeout : 0,
      {
        onHardDeadline: (reason) => aborter.abort(reason)
      },
      keepAliveOnTimeout ? undefined : finalTimeout,
      this.terminationGraceMs
    );

    try {
      let result = await Promise.race([promise, guard.start()]);
      guard.cancel();

      // [流式生命周期闭环]
      // 如果返回的是 Web ReadableStream，我们需要挂载观测器以监听流的结束/中止
      // 使用鸭子类型检查以兼容不同的 ReadableStream 实现 (Polyfill/Native)
      if (result && typeof result.getReader === 'function' && typeof result.cancel === 'function') {
        const handle = this.tracker.get(request.requestId);
        if (handle) {
          const transformer = createCallbacksTransformer({
            onClose: () => {
              handle.markStreamFinished();
              handle.onCleanup();
              if (handle.shouldCleanup(Date.now())) {
                this.tracker.remove(request.requestId);
              }
            }
          });
          // 包装流
          result = result.pipeThrough(transformer);
          // 让 Handle 持有流引用，以便在逻辑中止时能主动 cancel 流
          handle.setOutputStream(result);
        }
      }

      return this.echoRequestId(request, this.normalizeResult(result));
    } catch (err: any) {
      guard.cancel();

      if (err.code === RpcStatusCode.PROCESSING && keepAliveOnTimeout) {
        return this.handle102(request);
      }

      // 注意：Hard Deadline 触发时已经在 guard 内部通过 onHardDeadline 执行了 aborter.abort(err)
      throw err;
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
        status: RpcStatusCode.GATEWAY_TIMEOUT,
        error: { code: RpcStatusCode.GATEWAY_TIMEOUT, status: 'timeout', message: err.message || "Request Timeout" }
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

    // 1. 业务错误码 (Code) 优先使用原始 err.code，若无则兜底 500
    const errorCode = typeof err.code === 'number' ? err.code : 500;

    // 2. 映射物理/响应状态码 (Status)：始终基于 errorCode 的 HTTP 语义
    const responseStatus = (errorCode >= 100 && errorCode < 600) ? errorCode : 500;

    // 3. 状态标识字符串 (Status String)：直接透传业务指定的标识
    let errStatusStr = (typeof err.status === 'string') ? err.status : undefined;

    // 4. 自动补全常见状态字符串 (如果业务没传)
    if (!errStatusStr) {
      if (responseStatus === 404) errStatusStr = 'not_found';
      else if (responseStatus === 400) errStatusStr = 'bad_request';
      else if (responseStatus === 409) errStatusStr = 'conflict';
    }

    return {
      status: responseStatus,
      error: {
        code: errorCode,
        status: errStatusStr,
        message: err.message || String(err),
        data: err.data
      }
    };
  }
}
