# @isdk/tool-rpc 传输层重构详细设计文档 (v2.1)

本文档详尽记录了 `@isdk/tool-rpc` 传输层（Transport Layer）的重构方案。旨在通过“三权分立”架构（管理、调度、传输），彻底解决协议耦合、静态单例限制及执行生命周期失控等核心问题。

## 1. 架构哲学与核心目标

### 1.1 职责分离 (Separation of Concerns)
- **管理层 (RpcTransportManager)**：负责传输实例的生命周期、协议注册与基于 `apiUrl` 的逻辑路由。
- **调度层 (RpcServerDispatcher)**：负责工具的查找、执行上下文装配及死线守卫（Deadline Guard）。
- **传输层 (IToolTransport)**：作为“翻译官”，负责将协议原始报文翻译为归一化 Request/Response，并执行物理传输。

### 1.2 感知无关性 (Transport Agnosticism)
`ClientTools` 和 `ServerTools` 业务实例应完全感知不到 Transport 的存在。它们仅通过 `this.ctx.apiUrl` 表达意图，由管理层完成底层的物理适配。

### 1.3 执行确定性 (Execution Determinism)
引入 `RpcDeadlineGuard` 机制，确保无论是正常完成、响应超时（102/504）还是硬超时（强制终止），每一个 RPC 调用都有明确的生命周期终点。

---

## 2. 核心模型定义 (Core Models)

### 2.1 ToolRpcRequest
代表一个归一化的 RPC 请求对象，由 Transport 层构造。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `apiUrl` | `string` | **逻辑寻址标识**。包含协议、域名及路径（如 `http://srv/api`）。 |
| `toolId` | `string` | 目标工具的注册名称。 |
| `params` | `any` | 业务输入参数。 |
| `headers` | `Record<string, any>` | 归一化元数据。包含 `x-rpc-timeout`, `x-rpc-act`, `x-rpc-id` 等。 |
| `signal` | `AbortSignal` | 物理连接断开的原始信号，允许外部用户信号合并注入。 |
| `raw` | `any` | 保留对底层对象（如 `http.IncomingMessage`）的原始引用。 |

### 2.2 ToolRpcResponse
代表一个归一化的 RPC 响应结果。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `status` | `number` | 标准状态码（200: 成功, 102: 处理中, 504: 响应超时, 500: 错误）。 |
| `data` | `any \| ReadableStream` | 执行结果或流式数据。 |
| `headers` | `Record<string, any>` | 需要传回客户端的元数据。 |
| `error` | `string` (可选) | 错误详细消息（仅在 status >= 400 时）。 |

### 2.3 RpcExecutionContext (执行上下文对象)
作为 Request 与 Dispatcher 之间的桥梁，封装单次执行的环境。包含归一化后的 `timeout`、合并后的 `signal`、影子实例引用及 `apiUrl`。

---

## 3. 核心组件设计 (Core Components)

### 3.1 RpcTransportManager (传输管理器)
采用“双重职能模式”：静态类作为注册管理，实例作为传输调度。
- **静态职能**：负责 Transport 类型的注册（如 `http`, `mailbox`）。
- **路由寻址**：根据 `apiUrl` 自动匹配对应的 Transport 实例。提供 `get(apiUrl)` 接口，支持默认路由策略。
- **连接池**：管理活跃的物理通道实例，实现并发重入。

### 3.2 RpcServerDispatcher (请求调度器)
一个无状态、可重入的服务端执行引擎。
- **职责**：
    1. **查找与实例化**：根据 `toolId` 从 Registry 查找工具，并使用 `tool.with(ctx)` 创建影子实例。
    2. **上下文装配**：将 `apiUrl`, `headers` 注入 `this.ctx`，装配 `RpcExecutionContext`。
    3. **调度执行**：驱动 `tool.run()`，并配合 `RpcDeadlineGuard` 实施生命周期监控。
    4. **结果归一化**：统一捕获执行异常，并转化为标准 `ToolRpcResponse`。

### 3.3 IToolTransport (传输接口)
传输层的核心职能是**翻译与传输**。
- 剥离所有业务逻辑（如 `toolId` 解析、超时计算），仅负责协议特定的编解码。
- 将协议特定的上下文（如 HTTP 的 `req/res`）挂载到 `ToolRpcRequest.raw`。

---

## 4. 寿命周期与死线管理 (Lifecycle & Guard)

### 4.1 RpcDeadlineGuard (死线守卫)
专门负责“执法”，确保任务不逾越边界。
- **响应超时 (Response Timeout)**：
    - 到达 `timeout.value` 时触发。
    - 若 `keepAliveOnTimeout: true`，进入 **“后台维持 (Background Continuation)”** 模式，返回 `102 Processing`。
    - 若为 `false`，返回 `504` 并触发 `abort()`。
- **硬超时 (Hard Timeout)**：
    - 服务端强制终止阈值。一旦触发，必须立即调用 `AbortSignal.abort()` 强制终止。
- **优雅退出 (Graceful Exit)**：
    - 支持配置 `terminationGracePeriod`（终止优雅期）。
    - 触发 `abort()` 后等待清理逻辑执行，期满后强制物理断开流并释放影子实例。

---

## 5. 高级功能模块化

### 5.1 状态处理
- **RpcInterimHandler (中间态处理器)**：客户端 Transport 用于拦截 `102` 状态，并执行轮询或长连等待策略。
- **RpcStatusObserver (状态观察器)**：侧重于对执行进度的观察和维持。

### 5.2 流处理
针对不支持原生 Stream 的协议，引入精准命名的模组：
- **RpcStreamFragmenter (流分片器)**：将 `ReadableStream` 拆解为有序数据包。
- **RpcStreamReassembler (流重组器)**：在对端重组为标准的 `ReadableStream`。

---

## 6. 实施路线图与兼容性策略

### 6.1 兼容性设计 (Backward Compatibility)
- **静态 `setTransport` 适配**：保持 API 存在，但内部改为向 `RpcTransportManager` 注册默认路由。
- **寻址回退逻辑**：`fetch` 优先查找 `ctx.apiUrl` -> 静态 `apiUrl` -> 静态 `_transport`（若命中后者则发出弃用警告）。

### 6.2 实施步骤
1. **接口先行**：定义 `ToolRpcRequest/Response` 接口及 `RpcExecutionContext`。
2. **管理层实现**：开发 `RpcTransportManager` 双重职能类。
3. **引擎实现**：实现 `RpcServerDispatcher` 及其核心组件 `RpcDeadlineGuard`。
4. **业务层适配**：改造 `ClientTools` 和 `ServerTools` 以支持基于 `ctx` 的动态寻址。
5. **传输层重构**：瘦身现有的 HTTP 传输实现。
