# @isdk/tool-rpc 传输层重构详细设计文档 (v2.6)

本文档详尽规定 `@isdk/tool-rpc` 传输层（Transport Layer）的深度重构方案。旨在通过取消静态单例依赖、引入标准调度引擎，实现多实例并行运行下的物理隔离、执行确定性与全链路安全。

---

## 1. 架构定位与术语 (Architecture & Terms)

### 1.1 寻址方式：从 apiRoot 升级为 apiUrl

**BREAKING CHANGING** 重构后系统全面采用 **`apiUrl`** 作为逻辑寻址标识（包含协议 Scheme，如 `http://srv/v1`）。废弃原有的 `apiRoot` 路径前缀配置项。对于不支持路径的扁平协议，路径信息将通过标准 Header 进行承载。

### 1.2 核心组件职责 (Trinity Architecture)

1. **管理中心 (RpcTransportManager)**：协议注册中心、物理连接池与路由审计引擎。负责根据 `apiUrl` 寻址，管理传输实例的生命周期，并执行物理地址与逻辑路由的冲突校验。
2. **物理传输层 (IToolTransport)**：协议适配器与搬运工。负责协议报文与归一化对象的双向互转。在 V2 中引入了物理底座 (`getListenAddr`) 与逻辑路由 (`getRoutes`) 的分离，支持多实例对物理资源的共享。
3. **执行调度器 (RpcServerDispatcher)**：服务端核心引擎。独立于协议，负责工具查找、能力协商、AoP 组装及执行死线裁决。
4. **任务追踪器 (RpcActiveTaskTracker)**：活跃任务账本。隶属于调度器，支持跨协议的任务可见性、结果保留策略控制与物理中止联动。

---

## 2. 核心接口继承体系 (Inheritance Tree)

所有传输实现必须符合以下严密的接口继承规范，以确保多协议间的一致行为：

- **`IToolTransport`** (顶层接口)：定义基础寻址 (`apiUrl`) 及连接管理。
  - **`mount(tools: any)`**: `@deprecated` 临时保留的工具挂载方法。在 V2 中已由 `manager.addServer` 与 `addRpcHandler` 体系取代。
  - **`IServerToolTransport`** (服务端协议规范)：
    - **`getListenAddr()`**: 返回物理层面的监听地址标识（如 `:3000` 或 `localhost:8080`）。
      - **归一化要求**：实现类需将 `127.0.0.1`、`[::1]` 等回环地址归一化为 `localhost`，以确保物理底座池的精确命中。
      - **监听范围**：`:port` 表示监听 `0.0.0.0`，`host:port` 表示精确绑定。
    - **`getRoutes()`**: 返回该实例声明负责的逻辑路由列表。
      - **规范化要求**：所有路径必须以 `/` 结尾（Trailing Slash Normalization），以确保 `RpcTransportManager` 审计表中的字符串匹配与物理层的分发逻辑保持 100% 字面量一致。
    - **`HttpServerToolTransport`** (基于 Node.js 原生 http 模块，支持物理复用)。
    - **`MailboxServerToolTransport`** (基于内部分布式信箱，天然物理独占)。
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
| `act` | `string` | 否 | 动作或子方法。支持从 Header 或 Params 自动提升。 |
| `resId` | `string` | 否 | 资源唯一标识。支持从 Header 或 URL Path 自动提取。 |
| `traceId` | `string` | 否 | 全链路追踪 ID。用于跨服务日志关联。若为空，调度器需自动生成。 |
| `requestId` | `string` | 是 | 本次调用唯一 ID。用于任务句柄索引、状态查询及幂等校验。 |
| `params` | `any` | 是 | 业务参数对象。包含 `stream: boolean` 意图标记。 |
| `headers` | `Record<string, any>` | 否 | **标准 Header**：`rpc-timeout` (限时), `rpc-act` (动作), `rpc-priority` (优先级)。 |
| `signal` | `AbortSignal` | 否 | 归一化取消信号，用于同步物理链路的中断状态。 |

### 3.2 ToolRpcResponse (RPC 响应对象)

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| **`status`** | `number` | 是 | **物理/逻辑响应状态码**。用于控制物理协议行为及客户端基础判定。取值范围遵循 HTTP 标准 (100-599)。 |
| `data` | `any \| ReadableStream` | 否 | 执行成功时的业务结果或流式数据块。 |
| `headers` | `Record<string, any>` | 否 | **响应元数据**。例如 `rpc-retry-after` (102 建议轮询间隔)。 |
| **`error`** | `object` | 否 | **结构化错误负载**。包含以下字段：<br/>- **`code`** (number): 业务错误码，通常与顶层 `status` 一致。<br/>- **`status`** (string): 可选的语义化标识字符串（如 `'teapot'`）。<br/>- **`message`** (string): 错误描述。<br/>- **`data`** (any): 额外结构化负载。 |

**状态码逻辑对照表：**

| 状态码 | 语义 | 触发场景描述 |
| :--- | :--- | :--- |
| **200** | OK | 任务同步执行成功，或流式输出已成功启动。 |
| **102** | Processing | 触发响应超时，且开启 `keepAliveOnTimeout`，任务转入后台继续执行。 |
| **400** | Bad Request | **能力冲突**：请求流但工具不支持；或参数校验失败、协议格式非法。 |
| **404** | Not Found | 找不到目标工具或请求的任务 ID 已失效/过期。 |
| **408** | Terminated | **强制终止**：触及服务端硬死线（Hard Deadline），任务被强制中止。 |
| **409** | Conflict | **ID 冲突**：`requestId` 已在账本中激活且尚未回收，拒绝重复提交。 |
| **504** | Gateway Timeout | **响应超时**：触及限时，且任务不具备后台维持能力。 |

### 3.3 RpcTaskRetention (结果保留策略)

用于定义任务在完成后的保留模式：

* **`None` (0)**: 任务完成后立即从账本移除（默认）。
* **`Permanent` (-1)**: 永久保留，直到进程结束或手动删除。
* **`Once` ('once')**: 保留至第一次成功的 `rpcTask.get` 后清理。
* **`number` (ms)**: 任务完成后保留指定的毫秒数。
* **配置对象**: 支持 `onceFallbackMs`（'once' 模式下的清理兜底，默认 1 小时）和 `maxRetentionMs`（全模式硬上限）。

### 3.4 RpcError (标准错误类)

为了确保错误能被传输层正确识别并序列化，推荐在工具函数中抛出 `RpcError`。

* **构造函数**: `new RpcError(message, code: number = 500, status?: string, data?: any)`
* **职责分工 (Status vs. Code)**：
  - **`code` (number)**: 唯一的数字错误码。若在 100-599 范围内，`Dispatcher` 会自动将其映射为响应顶层的 `status`。
  - **`status` (string)**: 可选的语义化标识字符串（方案一）。如 `'teapot'`, `'missing_field'`。
* **映射逻辑**：`Dispatcher.handleError` 会根据 `err.code` 自动推导响应的物理状态码，并透传 `err.status` (string) 和 `err.data` (方案三)。 |

---

## 4. 核心组件深度设计 (Component Deep-Dive)

### 4.1 RpcTransportManager (逻辑路由与策略中心)

- **多实例支持**：默认提供全局单例 `RpcTransportManager.instance`，同时也支持通过 `new` 创建独立实例以满足测试隔离或多租户需求。
- **自动路由审计与冲突检测**：
    - 在调用 `addServer(transport)` 时，Manager 会提取其物理地址 (`getListenAddr`) 和逻辑路由 (`getRoutes`)。
    - 维护全局 `routeAudit` 审计表（`ListenAddr -> Set<RoutePath>`）。
    - **拦截规则**：若同一物理地址下尝试注册已存在的逻辑路由，立即抛出 `Routing Conflict` 异常，防止路由劫持。
- **二级映射寻址算法**：
    1. **协议层注册 (Static)**：Scheme（如 `mailbox`）映射到具体类。支持多 Scheme 映射到单类。提供 `clearSchemes(scheme?)` 用于清空注册表，解决测试交叉污染。
    2. **动态解析器 (Resolvers)**：支持注册函数式解析器，在静态表未命中时动态返回实现类。
    3. **实例层缓存 (Instance)**：按 `apiUrl` 的 Origin 路径缓存 Transport 物理实例，确保连接池隔离。
- **架构级策略校验 (`validateRpcRequest`)**：在调度前进行最终审计。包括 **SSRF 防御**（通过 `restrictedPatterns` 正则或字符串匹配）、协议白名单、工具访问权限控制。

### 4.2 RpcServerDispatcher (逻辑执行引擎)

- **流水线拆解**：
    1. **Resolution** (寻址): 查找工具（优先用户 Registry，后系统 Registry），执行路由信息（act/resId）提升。
    2. **Preparation** (准备): 超时协商，构建归一化 `ToolRpcContext` 并注入 `requestId`、追踪元数据及底层原生对象。
    3. **Execution** (执行): 调用工具函数获取 Promise。
    4. **Tracking** (注册): **立即登记**任务至 Tracker（包含 409 校验），确保全生命周期可见。
    5. **Waiting** (等待): 处理两级死线（102/408）。
- **能力协商 (Negotiation)**：预检 `tool.stream` 能力。若请求意图与工具能力冲突，Dispatcher 负责拦截并直接返回 `400`。
- **即时清理 (Immediate Cleanup)**：在响应返回后立即执行 `checkImmediateCleanup`，根据 `retention` 策略决定是否立即回收。

### 4.3 RpcActiveTaskTracker (活跃任务追踪器)

- **任务句柄 (RpcActiveTaskHandle) 状态机**：
  - **Cancellable 任务**：持有 `tool-func` 的原生 `Task` 实例。支持物理中止 (`task.abort()`) 与进度查询。
  - **非可取消任务**：
    - **逻辑丢弃**：切断响应链，结果不再回传。
    - **物理断连**：强行触发 `AbortSignal.abort()`，若涉及流，物理连接将根据信号释放。
- **流式生命周期管理**：
  - **`streamPending` 状态**：专门用于追踪 Web Stream 的传输状态。即使业务 Promise 已 resolve，只要流未结束，任务仍视为“活跃”。
  - **输出流绑定 (`setOutputStream`)**：Dispatcher 在识别到返回值为 `ReadableStream` 时，将其包装并绑定到 Handle，确保 Handle 能够感知并控制流的物理生命周期。
  - **自动清理联动**：通过监听流的 `flush` (正常结束) 或 `cancel` (中止)，Handle 自动调用 `markStreamFinished()` 并触发 Retention 评估。
- **信号联动**：Handle 深度联动 `AbortSignal`。一旦信号触发，任务状态立即强制同步为 `aborted`，并主动调用 `outputStream.cancel(reason)` 以释放底层资源，确保账本状态与物理执行状态实时同步。
- **跨协议可见性**：Tracker 独立于传输协议，支持在同作用域下通过信道 A 发起、信道 B 监控/取消。

### 4.4 RpcDeadlineGuard (执行死线守卫)

- **两级裁决逻辑**：
    1. **响应超时 (Soft Deadline)**：触发 `102`。
    2. **硬死线 (Hard Deadline)**：触及资源保护阈值。触发后立即调用 `AbortSignal.abort()`。
- **延迟中止 (Termination Grace Period)**：支持 `terminationGracePeriod` 配置（默认 500ms）。
    - 硬死线触发后，Guard 先触发信号中止以通知业务代码进行清理，并**延迟抛出 408 异常**，确保资源回收的平滑性。
    - 在宽限期结束后，若任务仍未自行退出，调度层正式返回 `408 Terminated` 响应。 |

### 4.5 物理复用与生命周期管理 (Lifecycle Management)

V2 架构通过 `IServerToolTransport` 的扩展接口实现了对底层物理资源的精细化管理：

- **HTTP 物理复用与精准路由策略**：
    - `HttpServerToolTransport` 内部维护静态 `sharedServers` 池，键值映射通过归一化的物理监听地址 (`getListenAddr`) 实现。
    - **地址归一化 (Normalization)**：自动将 `localhost` 等回环地址统一处理，确保同一物理端口仅开启一个 `http.Server`，最大限度实现资源共享。
    - **引用计数 (Ref Counting)**：通过计数器追踪物理 Server 的逻辑持有者数量。当最后一个逻辑 Transport 实例调用 `stop()` 时，物理底座自动回收并安全关闭监听端口。
    - **路由分发逻辑 (Routing)**：物理端口接收到请求后，采用 **“最长前缀匹配” (Longest Prefix Match)** 算法扫描逻辑实例。
      - **路径规范化**：所有路径在审计与分发前均需完成 **Trailing Slash Normalization**（尾随斜杠补齐），杜绝因路径拼接不规范导致的路由错配。
      - **HTTPS 考量**：若未来涉及 HTTPS 共享，建议在物理底座池键名中加入协议前缀以区分 TLS/TCP 复用。
- **Mailbox 独占性保护**：
    - `MailboxServerTransport` 默认接管全量路径 (`/`)。在 Manager 的路由审计下，这意味着对于同一个 Mailbox 地址，系统只允许激活一个 Transport 实例，从而在分布式信箱环境中天然保护了物理执行的唯一性。
- **服务激活 (`startAll`)**：针对所有已注册的服务端 Transport 批量调用 `start()`。
- **全局清理 (`stopAll`)**：批量调用所有逻辑实例的 `stop()` 或物理层的 `close()`。由于引入了引用计数，该操作能确保所有物理监听安全且完整地退出。

---

## 5. 与 tool-func 特性深度集成

### 5.1 可取消性集成 (Cancellability)

- **信号透传**：调度器自动将产生的 `signal` 链接至业务层的 `this.ctx.signal`。
- **硬性约束**：同步阻塞任务必须定期显式检查 `this.ctx.signal.aborted` 状态。

### 5.2 流式观测器与生命周期闭环 (Streaming Lifecycle)

- **全生命周期监控**：利用 **`TransformStream`** (Web Standard) 在 `Dispatcher` 层包装返回流。
    - **`flush` 钩子**：流正常结束时，调用 `handle.markStreamFinished()`。
    - **`cancel` 钩子**：流被下游取消时，自动触发任务状态的终结与资源清理。
- **重组技术规范**：`RpcStreamReassembler` 必须具备基于 **`sequenceNumber` 的顺序重排能力**，并实现基于流量反馈的 **背压 (Backpressure)** 控制。

---

## 6. 核心工作流伪代码 (Operational Blueprint)

### 6.1 服务端：基类驱动流程 (ServerToolTransport)

```typescript
export abstract class ServerToolTransport extends ToolTransport {
  // 模板方法：定义 RPC 请求的标准执行流水线
  protected async processIncomingCall(rawReq: any, rawRes: any, registry?: any) {
    try {
      // 1. 物理层翻译：子类将物理报文翻译为归一化对象
      const rpcReq = await this.toRpcRequest(rawReq);

      // 2. 架构层校验：调用 Manager 实例进行 SSRF/权限审计
      this.manager.validateRpcRequest(rpcReq);

      // 3. 执行分发：交给独立的 Dispatcher 流水线
      const rpcRes = await this.dispatcher.dispatch(rpcReq, registry);

      // 4. 物理层回传与物理中止联动：子类将结果写回物理通道
      // 在传输流时，需监听物理连接的 'close' 事件并调用 handle.abort('Physical connection closed')
      await this.sendRpcResponse(rpcRes, rawRes);
    } catch (err) {
      // 顶级异常防护，确保物理连接不挂起
      await this.sendRpcResponse(this.dispatcher.handleError(null, err), rawRes);
    }
  }
}
```

### 6.2 客户端：中间态轮询 (RpcInterimHandler)

```typescript
async handleInterim(response: ToolRpcResponse, originalRequest: ToolRpcRequest) {
  if (response.status === 102) {
    // 按照服务端建议的 retry-after 间隔进行退避
    const waitTime = response.headers['rpc-retry-after'] || 5000;
    await sleep(waitTime);

    // 构造显式的状态查询请求 (rpc-act: status)，保证非幂等安全
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
- **setTransport 适配器**：将原有 Transport 实例注册至 `RpcTransportManager.instance` 全局单例。
- **旧版参数桥接**：`elevateV1ParamsToV2Request` 确保写在 `params.id/act` 中的信息能被 V2 调度器正确识别。

---

## 8. 评估结论

本重构方案通过解耦物理传输与执行调度、引入显式的执行句柄追踪（Tracker）与多级死线控制（Guard），彻底解决了长耗时任务在分布式环境下的观测盲区与资源泄露风险。方案深度整合了 `tool-func` 原生异步特性，为 `@isdk/tool-rpc` 提供了工业级的安全性、确定性与跨协议管理能力。
