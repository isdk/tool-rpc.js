# @isdk/tool-rpc 传输层重构详细设计文档 (v2.3)

本文档详尽规定 `@isdk/tool-rpc` 传输层（Transport Layer）的深度重构方案。旨在通过取消静态单例依赖、引入标准调度引擎，实现多实例并行运行下的物理隔离、执行确定性与全链路安全。

---

## 1. 架构定位与术语 (Architecture & Terms)

### 1.1 寻址方式：从 apiRoot 升级为 apiUrl
**BREAKING CHANGING** 重构后系统全面采用 **`apiUrl`** 作为逻辑寻址标识（包含协议 Scheme，如 `http://srv/v1`）。废弃 `apiRoot` 路径前缀配置项。

### 1.2 核心组件职责 (Trinity Architecture)
1. **管理中心 (RpcTransportManager)**：协议注册中心与物理连接池。负责根据 `apiUrl` 寻址，管理传输实例的生命周期与架构级策略校验。
2. **物理传输层 (IToolTransport)**：协议适配器与搬运工。负责协议报文与归一化对象的双向互转，并控制底层物理通信控制。
3. **执行调度器 (RpcServerDispatcher)**：服务端核心引擎。独立于协议，负责工具查找、能力协商及执行死线裁决。
4. **任务追踪器 (RpcActiveTaskTracker)**：活跃任务账本。隶属于调度器，支持跨协议的任务可见性与控制。

---

## 2. 核心接口继承体系 (Inheritance Tree)

所有传输实现必须符合以下严密的接口继承规范，以确保多协议间的一致行为：

- **`IToolTransport`** (顶层接口)：定义基础寻址 (`apiUrl`) 及连接管理。
  - **`mount(tools: any)`**: `@deprecated` 临时保留的工具挂载方法。应使用 `listen(server)` 或通过构造函数注入实现关联。
  - **`IServerToolTransport`** (服务端协议规范)：
    - **`HttpServerToolTransport`** (基于 Node.js 原生 http 模块)。
    - **`MailboxServerToolTransport`** (基于内部分布式信箱)。
  - **`IClientToolTransport`** (客户端协议规范)：
    - **`HttpClientToolTransport`** (基于 fetch/http client)。
    - **`MailboxClientToolTransport`** (基于信箱投递协议)。

---

## 3. 归一化模型定义 (Standardized Data Models)

### 3.1 ToolRpcRequest (RPC 请求对象)
| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `apiUrl` | `string` | 是 | 完整的逻辑寻址 URL，决定协议类型与分发路径。 |
| `toolId` | `string` | 是 | 目标工具名称（注册名）。 |
| `traceId` | `string` | 是 | 全链路追踪 ID。用于跨服务日志关联。若为空，调度器需自动生成。 |
| `requestId` | `string` | 是 | 本次调用唯一 ID。用于任务句柄索引、状态查询及幂等校验。 |
| `params` | `any` | 是 | 业务参数对象。包含 `stream: boolean` 意图标记。 |
| `headers` | `Record<string, any>` | 否 | **标准 Header**：`rpc-timeout` (限时), `rpc-act` (动作), `rpc-priority` (优先级)。 |
| `signal` | `AbortSignal` | 否 | 归一化取消信号，用于同步物理链路的中断状态。 |

### 3.2 ToolRpcResponse (RPC 响应对象)
| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `status` | `number` | 是 | **逻辑状态码**（详见下表）。 |
| `data` | `any \| ReadableStream` | 否 | 执行结果或流式数据块。 |
| `headers` | `Record<string, any>` | 否 | **响应元数据**。例如 `rpc-retry-after` (102 建议轮询间隔)。 |
| `error` | `object` | 否 | 结构化错误：`{ code, message, stack }`。 |

**状态码逻辑对照表：**
| 状态码 | 语义 | 触发场景描述 |
| :--- | :--- | :--- |
| **200** | OK | 任务同步执行成功，或流式输出已成功启动。 |
| **102** | Processing | 触发响应超时，但由于开启 `keepAliveOnTimeout`，任务转入后台继续执行。 |
| **400** | Bad Request | **能力冲突**：请求流但工具不支持；或参数校验失败、协议格式非法。 |
| **408** | Terminated | **强制终止**：触及服务端硬死线（Hard Deadline），任务被强制中止并回收。 |
| **504** | Gateway Timeout | **响应超时**：触及限时，且任务不具备后台维持能力。 |
| `error` | `object` | 否 | 结构化错误：`{ code, message, stack, data }`。 |

### 3.3 RpcError (标准错误类)
为了确保错误能被传输层正确识别并序列化，推荐在工具函数中抛出 `RpcError`。
* **构造函数**: `new RpcError(message, status?, code?, data?)`
* **优势**: 自动携带逻辑状态码与业务 code，支持携带额外的 `data` 负载。

---

## 4. 核心组件深度设计 (Component Deep-Dive)

### 4.1 RpcTransportManager (逻辑路由与策略中心)
- **多实例支持**：默认提供全局单例 `RpcTransportManager.instance`，同时也支持通过 `new` 创建独立实例以满足测试隔离或多租户需求。
- **二级映射寻址算法**：
    1. **协议层注册 (Static)**：Scheme（如 `mailbox`）映射到具体类。支持多 Scheme 映射到单类。
    2. **实例层缓存 (Instance)**：按 `apiUrl` 的 Origin 路径缓存 Transport 物理实例，确保连接池隔离。
- **静态清理 (`clearSchemes`)**：提供 `RpcTransportManager.clearSchemes(scheme?)` 用于清空注册表，解决单元测试间的交叉污染。
- **架构级策略校验 (`validateRpcRequest`)**：在调度前进行最终审计。包括 SSRF 防御（`allowList`）、协议白名单、工具访问权限控制。

### 4.2 RpcServerDispatcher (逻辑执行引擎)
- **实例协作**：调度器通过构造函数绑定私有的 `RpcActiveTaskTracker` 实例。
- **两级工具查找 (System Fallback)**：
    1. 优先从用户提供的 `registry` 中查找工具。
    2. 若未命中且请求的是系统级工具（如 `rpcTask`），则回退到内置的 `systemRegistry` 查找。这确保了长任务管理功能开箱即用，同时允许用户通过同名注册进行覆盖。
- **能力协商 (Negotiation)**：预检 `tool.stream`能力。若请求意图与能力冲突，Dispatcher 负责拦截并直接返回 `400`。
- **AoP 装配**：负责将寻址与追踪元数据（`traceId`, `requestId`, `apiUrl`）注入影子实例的 `this.ctx`。
- **健壮性增强**：`handleError` 能够自动兼容处理原始字符串、非 Error 对象等异常抛出。


### 4.3 RpcActiveTaskTracker (活跃任务追踪器)
- **任务句柄 (ActiveTaskHandle) 状态机**：
    - **Cancellable 任务**：持有 `tool-func` 的原生 `Task` 实例。支持物理中止 (`task.abort()`) 与进度查询。
    - **非可取消任务**：
        - **逻辑丢弃**：切断响应链，结果不再回传。
        - **物理断连**：若涉及流，强行调用 `stream.cancel()` 或销毁物理连接，确保服务端资源释放。
- **跨协议可见性**：Tracker 独立于传输协议，支持在同作用域下通过信道 A 发起、信道 B 监控。

### 4.4 RpcDeadlineGuard (执行死线守卫)
- **两级裁决逻辑**：
    1. **响应超时**：触发 `102` 或 `504`。
    2. **硬死线 (Hard Deadline)**：触及服务端资源保护阈值。触发后立即调用 `AbortSignal.abort()`。
- **优雅退出**：支持 `terminationGracePeriod` 配置，死线触发后给予工具清理时间，随后执行物理资源强制回收。

### 4.5 通用生命周期管理 (Lifecycle Management)
`RpcTransportManager` 统一负责客户端与服务端 Transport 实例的创建、激活与资源回收：

- **实例映射与复用**：
  - **客户端**：Manager 根据目标 `apiUrl` 的 Origin（如域名/端口）查找或创建 Transport 实例。通过实例复用实现连接池共享与 Header 配置统一。
  - **服务端**：Manager 按协议需求创建并持有 Transport 实例，将其与 `Dispatcher` 关联。
- **服务激活 (`listen`)**：仅针对服务端 Transport。必须通过此方法将其接入物理载体（如 HTTP Server 或分布式信箱），使其正式开始搬运流量。
- **全局清理 (`closeAll`)**：Manager 提供统一入口，通过遍历所有托管的 Transport 实例并执行其 `close()` 方法，实现服务端监听资源与客户端物理连接池的批量优雅回收。

---

## 5. 与 tool-func 特性深度集成

### 5.1 可取消性集成 (Cancellability)
- **信号联动**：调度器自动将网络层产生的 `signal` 链接至业务层的 `this.ctx.aborter`。
- **硬性约束**：同步阻塞任务（如大循环）必须定期显式检查 `this.ctx.signal.aborted` 状态。

### 5.2 流式观测器与重组 (Streaming)
- **全生命周期监控**：利用 `createCallbacksTransformer` 监听流事件。`onFinal` 钩子必须负责注销任务句柄。
- **重组技术规范**：`RpcStreamReassembler` 必须具备基于 **`sequenceNumber` 的顺序重排能力**，并实现基于流量反馈的 **背压 (Backpressure)** 控制。

---

## 6. 核心工作流伪代码 (Operational Blueprint)

### 6.1 服务端：基类驱动流程 (ServerToolTransport)
```typescript
export abstract class ServerToolTransport extends ToolTransport {
  // 默认会采用单例上的默认实例，允许用户自定义
  constructor(options? :{manager?: RpcTransportManager, dispatcher?: RpcServerDispatcher}) {
    super(options);
  }

  /**
   * @deprecated 临时保留工具挂载，用于兼容旧版调用。
   * 在新架构中，工具注册表由 Dispatcher 或其关联的 Registry 实例直接管理。
   */
  mount(tools: any) {
    // 仅做兼容性引用，不再参与核心调度链路
    this._legacyTools = tools;
  }

  /**
   * 模板方法：定义 RPC 请求的标准执行流水线
   */
  async processIncomingCall(rawReq: any, rawRes: any) {
    // 1. 物理层翻译：子类负责将原始报文翻译为归一化对象
    const rpcReq = await this.toRpcRequest(rawReq, rawRes);

    // 2. 架构层校验：调用所属 Manager 实例进行策略审计
    this.manager.validateRpcRequest(rpcReq);

    // 3. 执行调度：交给绑定的引擎实例执行（不再由 Transport 传递工具表）
    const rpcRes = await this.dispatcher.dispatch(rpcReq);

    // 4. 物理层回传：子类负责将结果写回物理通道
    await this.sendRpcResponse(rpcRes, rawRes);
  }

  protected abstract toRpcRequest(rawReq: any, rawRes: any): Promise<ToolRpcRequest>;
  protected abstract sendRpcResponse(rpcRes: ToolRpcResponse, rawRes: any): Promise<void>;
}
```

### 6.2 服务端：执行分发流 (RpcServerDispatcher)
```typescript
class RpcServerDispatcher {
  // 通过构造函数绑定追踪器与工具注册表
  constructor(private tracker: RpcActiveTaskTracker, private registry: typeof ServerTools) {}

  async dispatch(request: ToolRpcRequest) {
    // 1. 拦截状态查询动作，实现跨信道可见性
    const activeHandle = this.tracker.get(request.requestId);
    if (request.headers['rpc-act'] === 'status') {
      return activeHandle ? activeHandle.getStatus() : formatError(404, "Task Not Found");
    }

    // 2. 从绑定的注册表中查找工具并进行能力协商
    const tool = this.registry.get(request.toolId);

    const wantsStream = request.params.stream === true;
    if (wantsStream && !tool.stream) return formatResponse(400, "Streaming not supported");

    const runner = tool.with({ ...request.headers, requestId: request.requestId, traceId: request.traceId || uuid() });
    const promise = runner.run(request.params);

    // 3. 注册任务句柄至追踪器
    const handle = new ActiveTaskHandle(promise, {
      task: (promise as any).task, // 自动捕获可取消句柄
      isStream: wantsStream,
      onCleanup: () => this.tracker.remove(request.requestId)
    });
    this.tracker.add(request.requestId, handle);

    // 4. 挂载死线守卫
    const guard = new RpcDeadlineGuard(request.timeout, {
      onResponseTimeout: () => handle.sendInterim(102),
      onHardDeadline: () => handle.terminate("Physical Timeout Triggered")
    });

    try {
      const result = await Promise.race([promise, guard.start()]);
      if (wantsStream) {
        const observer = createCallbacksTransformer({ onFinal: () => handle.cleanup() });
        return formatResponse(200, result.pipeThrough(observer));
      }
      return formatResponse(200, result);
    } catch (err) {
      return formatError(err.status || 500, err.message);
    }
  }
}
```

### 6.3 客户端：中间态轮询 (RpcInterimHandler)
```typescript
async handleInterim(response: ToolRpcResponse, originalRequest: ToolRpcRequest) {
  if (response.status === 102) {
    // 按照服务端建议的 retry-after 间隔进行退避
    const waitTime = response.headers['rpc-retry-after'] || 5000;
    await sleep(waitTime);

    // 构造显式的状态查询请求，严禁重发原请求，保证非幂等安全
    const pollRequest = {
      ...originalRequest,
      headers: { ...originalRequest.headers, 'rpc-act': 'status' }
    };

    // 通过物理传输层发送查询，并递归处理后续状态
    const nextResponse = await this.poll(pollRequest);
    return this.handleInterim(nextResponse, originalRequest);
  }
  return response;
}
```

---

## 7. 兼容性与迁移策略
- **apiRoot 自动映射**：系统将其包装为 `http://localhost/apiRoot` 格式。
- **setTransport 适配器**：将 Transport 实例注册至 `RpcTransportManager.instance` 全局单例。
- **旧版 mount 迁移**：原有 `mount(ServerTools)` 调用将被路由至关联的 `Dispatcher` 实例。

---

## 8. 评估结论
本方案通过移除静态依赖、引入显式的执行句柄追踪与双级死线控制，彻底实现了传输协议的透明化。方案深度整合了 `tool-func` 原生异步特性，为长耗时任务在分布式环境下的稳定执行提供了工业级的安全性与可观测性。
