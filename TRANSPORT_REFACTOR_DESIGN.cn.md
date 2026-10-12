# @isdk/tool-rpc 传输层重构详细设计文档 (v2.6)

本文档详尽规定 `@isdk/tool-rpc` 传输层（Transport Layer）的深度重构方案。旨在通过取消静态单例依赖、引入标准调度引擎，实现多实例并行运行下的物理隔离、执行确定性与全链路安全。

---

## 1. 架构定位与术语 (Architecture & Terms)

### 1.1 寻址方式：从 apiRoot 升级为 apiUrl

**BREAKING CHANGING** 重构后系统全面采用 **`apiUrl`** 作为逻辑寻址标识（包含协议 Scheme，如 `http://srv/v1`）。废弃原有的 `apiRoot` 路径前缀配置项。对于不支持路径的扁平协议，路径信息将通过标准 Header 进行承载。

### 1.2 核心组件职责 (Trinity Architecture)

1. **管理中心 (RpcTransportManager)**：协议注册中心、物理连接池与路由归属登记引擎。负责根据 `apiUrl` 寻址，管理传输实例的生命周期，并执行物理地址与逻辑路由的冲突校验。
2. **物理传输层 (IToolTransport)**：协议适配器与搬运工。负责协议报文与归一化对象的双向互转。在 V2 中引入了物理底座 (`getListenAddr`) 与逻辑路由 (`getRoutes`) 的分离，支持多实例对物理资源的共享。
3. **执行调度器 (RpcServerDispatcher)**：服务端核心引擎。独立于协议，负责工具查找、能力协商、AoP 组装及执行死线裁决。
4. **任务追踪器 (RpcActiveTaskTracker)**：活跃任务账本。隶属于调度器，支持跨协议的任务可见性、结果保留策略控制与物理中止联动。

---

## 2. 核心接口继承体系 (Inheritance Tree)

所有传输实现必须符合以下严密的接口继承规范，以确保多协议间的一致行为：

- **`IToolTransport`** (顶层接口，`src/transports/base.ts`)：`apiUrl`（寻址基准）、`options`、`manager` 引用，以及可选的
  `start()` / `stop()` / `close()` 生命周期钩子（另有 `[name: string]: any` 逃生索引）。
  - **`mount(tools: any)`**: `@deprecated` 工具挂载方法——注意它**不在** `IToolTransport` 上，而是 `ClientToolTransport`
    的方法（仅把 `apiUrl` 复制到工具类）。在 V2 中已由 `manager.registerServer` 与 `addRpcHandler` 体系取代。
  - **`IServerToolTransport`** (服务端协议规范)：
    - **`getListenAddr()`**: 返回物理层面的监听地址标识（如 `:3000` 或 `localhost:8080`）。
      - **归一化要求**：实现类需将 `127.0.0.1`、`[::1]` 等回环地址归一化为 `localhost`，以确保物理底座池的精确命中。
      - **监听范围**：`:port` 表示监听 `0.0.0.0`，`host:port` 表示精确绑定。
    - **`getRoutes()`**: 返回该实例声明负责的逻辑路由列表（每个前缀一条）。
      - **规范化要求（已修订）**：逻辑路由以 **canonical 形式**存储——以 `/` 开头、**不带**尾随斜杠（根路由为 `/`），并压缩重复斜杠；由 `ServerToolTransport.toPathname()` 统一实现。前缀匹配与物理路由表的 key 则由 `toMatchPrefix()` 派生（补尾随斜杠，根仍为 `/`），以保证 `/api` 不会误匹配 `/apix`。即：**归属登记比对用归一化前缀，分发匹配用 match 形式**，两者由基类同一组 helper 派生，实现类不再手写拼接。
      - **声明方式**：调用基类的 `claimRoute(apiUrl, kind, options)`，它同时完成归一化、多前缀簿记（`prefix -> { apiUrl, registry, discoveryHandler }`）与重复声明的 `remount` 决策（`'replace'` 默认 / `'throw'`）。
    - **`addRoute(apiUrl, entry)` / `getRouteTable()`**（已修订：新增的路由表）：前缀本身只回答「这个实例管哪段路径」，前缀**内**的路径→工具寻址由一张表描述：
      `entry = { path, when?: { method?, act? }, toolId, act?, resId? }`（`path` 是前缀内路径，根为 `'/'`）。
      `getRouteTable()` 返回含内置行的全部条目，适配器可拿去自己框架里原生注册；内置发现端点（`GET 前缀根` 与
      `act: 'list' | 'get'` → `rpcApis`）就是表里的普通行，第三方用同一路径同条件声明就能换掉它——**没有特权通道**。
      匹配规则（`''` 与 `'/'` 同义、`/x` 与 `/x/` 默认同义、最长前缀胜出）集中在 `route-path.ts`，请求侧与注册侧共用同一套。
    - **`addDiscoveryHandler(apiUrl, handler)`**（已标 `@deprecated`）：发现端点已由内置工具 `rpcApis` 回答，它降为兼容外壳：
      只把 handler 挂成该前缀的 `rpcApis` 清单实现，不再生成第二条物理路由；首次调用经 `warnDiscoveryDeprecated()` 打一次迁移提示。
    - **`HttpServerToolTransport`** (基于 Node.js 原生 http 模块，支持物理复用)。
    - **`MailboxServerTransport`** (基于内部分布式信箱，天然物理独占)。
  - **`IClientToolTransport`** (客户端协议规范)：
    - **`HttpClientToolTransport`** (基于 fetch/http client)。
    - **`MailboxClientTransport`** (基于信箱投递协议；构造签名是**单个 options 对象**且 `clientAddress` 必填，
      因此不能走 `bindScheme` 的 `new Class(apiUrl, options)` 自动构造，需先 `new` 再 `instance.register(transport)`)。
  - **Client ID 统一注入机制**：
    - `ClientToolTransport.fetch()` 基类方法中，当 `fetchOptions.clientId` 存在时，自动将其注入到 `fetchOptions.headers[RPC_HEADERS.CLIENT_ID]`（即 `rpc-client-id`）。
    - 各协议客户端实现（HTTP、Mailbox）通过展开 `fetchOptions.headers` 自动继承 `clientId`，无需在每个传输层中重复处理。
    - 服务端各协议在 `toRpcRequest()` 中从 header 提取 `rpc-client-id` 并赋值到 `ToolRpcRequest.clientId` 可选字段。

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
| `clientId` | `string` | 否 | 客户端标识，用于 session 识别。由客户端传输层基类从 `fetchOptions.clientId` 自动注入到头 `rpc-client-id` 中，服务端 `toRpcRequest()` 从 header 解析并赋值到此字段。 |
| `headers` | `Record<string, any>` | 是 | **标准 Header**（完整定义见 `RPC_HEADERS`）：`rpc-fn` (工具 id), `rpc-act` (动作), `rpc-res-id` (资源 id), `rpc-timeout` (限时), `req-id` (调用 id), `trace-id` (追踪), `rpc-retry-after` (轮询间隔), `rpc-client-id` (客户端标识)。**无 `rpc-priority` 头**（优先级未实现）。 |
| `identity` | `RpcIdentity` | 否 | 服务端判定的身份（装了 `RpcIdentityPolicy` 才有）；业务侧只从 `ctx.identity` 读。 |
| `raw` | `any` | 否 | 底座原生对象逃生口（HTTP 为 `{ _req, _res }`），调度器拆成 `ctx.req` / `ctx.reply`。 |

> **取消信号不在 `ToolRpcRequest` 上**：`AbortSignal` 属于执行侧——`prepareContext()` 为每次调用新建
> `AbortController`，把它的 `signal` 放进 `ToolRpcContext.signal`（兼容层再镜像成 `params._signal`）。

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
| **401** | Unauthenticated | 身份策略拒绝：凭证缺失或验不过（`RpcStatusCode.UNAUTHENTICATED`）。 |
| **404** | Not Found | 找不到目标工具或请求的任务 ID 已失效/过期。 |
| **408** | Terminated | **强制终止**：触及服务端硬死线（Hard Deadline），任务被强制中止。 |
| **409** | Conflict | **ID 冲突**：`requestId` 已在账本中激活且尚未回收，拒绝重复提交。 |
| **413** | Too Large | **实体过大**：请求体（Body）超过传输层设定的 `maxBodySize` 限制。 |
| **500** | Internal Error | 工具执行抛错（`RpcStatusCode.INTERNAL_ERROR`）。 |
| **504** | Gateway Timeout | **响应超时**：触及限时，且任务不具备后台维持能力。注意硬死线的 `408 RpcError` 会被 `handleError()` 映射为 **504**（`status: 'timeout'`）；408 只出现在轮询路径。 |

### 3.3 RpcTaskRetention (结果保留策略)

用于定义任务在完成后的保留模式：

* **`None` (0)**: 任务完成后立即从账本移除（默认）。
* **`Permanent` (-1)**: 永久保留，直到进程结束或手动删除。
* **`Once` ('once')**: 保留至第一次成功的 `rpcTask.get` 后清理。
* **`number` (ms)**: 任务完成后保留指定的毫秒数。
* **配置对象 `RpcTaskRetentionConfig`**: `{ mode, onceFallbackMs?, maxRetentionMs? }`——`mode` 必填（上面四种形式之一），
  `onceFallbackMs` 是 'once' 模式下的清理兜底（默认 1 小时），`maxRetentionMs` 是全模式硬上限。

### 3.4 RpcError (标准错误类)

为了确保错误能被传输层正确识别并序列化，推荐在工具函数中抛出 `RpcError`。

* **构造函数**: `new RpcError(message, code: number = 500, status?: string, data?: any)`
* **职责分工 (Status vs. Code)**：
  - **`code` (number)**: 唯一的数字错误码。若在 100-599 范围内，`Dispatcher` 会自动将其映射为响应顶层的 `status`。
  - **`status` (string)**: 可选的语义化标识字符串。如 `'teapot'`, `'missing_field'`。
* **映射逻辑**：`Dispatcher.handleError` 会根据 `err.code` 自动推导响应的物理状态码，并透传 `err.status` (string) 与 `err.data`。

---

## 4. 核心组件深度设计 (Component Deep-Dive)

### 4.1 RpcTransportManager (逻辑路由与策略中心)

- **多实例支持**：默认提供全局单例 `RpcTransportManager.instance`，同时也支持通过 `new` 创建独立实例以满足测试隔离或多租户需求。
- **自动路由归属登记与冲突检测**：
  - 在调用 `registerServer(transport)` 时，Manager 会提取其物理地址 (`getListenAddr`) 和逻辑路由 (`getRoutes`)。
  - 维护全局 `routeOwnership` 归属表（`ListenAddr -> Set<RoutePath>`）。
  - **拦截规则**：若同一物理地址下尝试注册已存在的逻辑路由，立即抛出 `Routing Conflict` 异常，防止路由劫持。
  - **动词对**：`registerServer()` / `unregisterServer()`（旧名 `addServer()` 已废弃，仅作转发）。`unregisterServer()` 只注销归属与 transport 映射，**不**停底层 server。与 transport 侧的 `registerRoutes()` / `unregisterRoutes()` 同族——后者是框架适配器的推荐入口，它同时完成 `claimRoute()` 与归属登记，且可重复调用（先注销再登记）。
- **二级映射寻址算法**：
  1. **协议层注册 (Static)**：Scheme（如 `mailbox`）映射到具体类。支持多 Scheme 映射到单类。提供 `clearSchemes(scheme?)` 用于清空注册表，解决测试交叉污染。
  2. **动态解析器 (Resolvers)**：支持注册函数式解析器，在静态表未命中时动态返回实现类。
  3. **实例层缓存 (Instance)**：以**完整 apiUrl 字符串**为 key 缓存 Transport 实例（`transports.set(apiUrl, inst)`）。
     同 Origin 不同 path 不会自动复用客户端实例；物理底座共享是**服务端**侧靠 `getListenAddr()` + 路由表实现的。
- **架构级策略校验 (`validateRpcRequest`)**：在调度前进行最终策略校验。包括 **SSRF 防御**（通过 `restrictedPatterns` 正则或字符串匹配）、协议白名单、工具访问权限控制。

### 4.2 RpcServerDispatcher (逻辑执行引擎)

- **并发隔离与影子实例 (Shadow Instance)**：
  - 为彻底解决单例工具在异步环境下的 `this.ctx` 竞态冲突，Dispatcher 在执行阶段利用 `tool-func` 的原型链机制创建影子实例。
  - **机制**：通过 `runner = tool.with(context)` 产生新实例。该实例的 `this.ctx` 仅属于本次调用，确保在极高并发下上下文信息的物理隔离。
  - **约束**：严禁在 `Dispatcher` 中直接修改原始工具对象的属性。
- **流水线拆解**：
  1. **Resolution** (寻址): 查找工具（优先用户 Registry，后系统 Registry），执行路由信息（act/resId）提升。
  2. **Preparation** (准备): 超时协商，构建归一化 `ToolRpcContext` 并注入 `requestId`、追踪元数据及底层原生对象。
  3. **Execution** (执行): 调用工具函数获取 Promise。
  4. **Tracking** (注册): **立即登记**任务至 Tracker（包含 409 校验），确保全生命周期可见。
  5. **Waiting** (等待): 处理两级死线（102/408）。
- **能力协商 (Negotiation)**：预检 `tool.stream` 能力。若请求意图与工具能力冲突，Dispatcher 负责拦截并直接返回 `400`。
- **即时清理 (Immediate Cleanup)**：在响应返回后立即执行 `checkImmediateCleanup`，根据 `retention` 策略决定是否立即回收。

### 4.3 RpcActiveTaskTracker (活跃任务追踪器)

- **后台硬死线防护 (Background Guard Timer)**：
  - 在 V2.6 中引入了针对后台任务的物理终止机制。
  - 每个 `RpcActiveTaskHandle` 在创建时可选注入 `maxRuntimeMs`。一旦任务运行时间超过此限制，Tracker 将强制触发 `handle.abort()`。
  - 此机制确保了即便物理连接已断开且响应已返回 (102)，后台任务也不会因逻辑死循环而永久占用系统资源。
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
- **延迟中止 (Termination Grace Period)**：支持 `dispatcher.terminationGraceMs` 配置（默认 `RPC_DEFAULTS.TERMINATION_GRACE_MS` = 500ms）。
  - 硬死线触发后，Guard 先触发信号中止以通知业务代码进行清理，并**延迟抛出 408 异常**，确保资源回收的平滑性。
  - 在宽限期结束后，若任务仍未自行退出，调度层正式返回 `408 Terminated` 响应（同步路径下会被 `handleError()` 映射为 504）。

### 4.5 物理复用与生命周期管理 (Lifecycle Management)

V2 架构通过 `IServerToolTransport` 的扩展接口实现了对底层物理资源的精细化管理：

- **HTTP 安全防护与性能边界**：
  - **Body 限制 (DoS Protection)**：引入 `maxBodySize` 配置项（默认 1MB）。传输层在消费 Request 流时实时累加字节数，一旦超限立即熔断物理连接并返回 `413`。
  - **分发器重构**：物理请求入口 `handleIncomingHttpRequest` 统一采用静态方法实现，通过归一化物理地址 (`ListenAddr`) 检索 `Binding` 记录，消除实例绑定的不确定性。
- **HTTP 物理复用与精准路由策略**：
  - `HttpServerToolTransport` 内部维护静态 `sharedServers` 池，键值映射通过归一化的物理监听地址 (`getListenAddr`) 实现。
  - **地址归一化 (Normalization)**：自动将 `localhost` 等回环地址统一处理，确保同一物理端口仅开启一个 `http.Server`，最大限度实现资源共享。
  - **引用计数 (Ref Counting)**：通过计数器追踪物理 Server 的逻辑持有者数量。当最后一个逻辑 Transport 实例调用 `stop()` 时，物理底座自动回收并安全关闭监听端口。
  - **路由分发逻辑 (Routing)**：物理端口接收到请求后，采用 **“最长前缀匹配” (Longest Prefix Match)** 算法扫描逻辑实例。
    - **路径规范化**：归属登记与 `getRoutes()` 使用归一化前缀（无尾随斜杠）；写入与比对物理分发表时再由 `toMatchPrefix()` 完成 **Trailing Slash Normalization**（尾随斜杠补齐），杜绝因路径拼接不规范导致的路由错配。
    - **前缀内寻址（路由表）**：前缀命中后，请求在**该前缀的路由表**里再做一次匹配（前缀内路径 + `method` / `act` 条件 → `toolId`）。
      内置发现行就在表里，所以发现调用与业务调用走同一条流水线（`validateRpcRequest` / 身份判定 / `globalTimeout` 均管得到）；
      旧客户端只发 `act: 'list' | 'get'` 也能命中同一行。
    - **HTTPS 考量**：若未来涉及 HTTPS 共享，建议在物理底座池键名中加入协议前缀以区分 TLS/TCP 复用。
- **Mailbox 独占性保护**：
  - `MailboxServerTransport` 默认接管全量路径 (`/`)。在 Manager 的路由归属登记下，这意味着对于同一个 Mailbox 地址，系统只允许激活一个 Transport 实例，从而在分布式信箱环境中天然保护了物理执行的唯一性。
- **服务激活 (`startAll`)**：针对所有已注册的服务端 Transport 批量调用 `start()`。
- **全局清理 (`stopAll`)**：批量调用所有逻辑实例的 `stop()` 或物理层的 `close()`。由于引入了引用计数，该操作能确保所有物理监听安全且完整地退出。

---

## 5. 与 tool-func 特性深度集成

### 5.1 可取消性集成 (Cancellability)

- **信号透传**：调度器自动将产生的 `signal` 链接至业务层的 `this.ctx.signal`。
- **硬性约束**：同步阻塞任务必须定期显式检查 `this.ctx.signal.aborted` 状态。

### 5.2 流式观测器与生命周期闭环 (Streaming Lifecycle)

- **传输层能力判定 (Transport Capability Check)**：
  - `IServerToolTransport` 接口新增 `canStream` 属性（基类默认 `false`，HTTP 服务端置 `true`）。
  - **拦截规则**：在 `processIncomingCall` 管线中，若工具返回 `ReadableStream` 但当前传输协议不支持流式搬运（如 Mailbox），系统将自动降级响应为 `400 Bad Request`，并提示协议能力冲突，防止非法序列化操作。
  - 注意这是 **dispatch 之后的后置判定**（`server.ts` 在拿到 `rpcRes` 后才查 `canStream`）：工具已经执行、流已经产生，只是不外发。能力也是服务端单方面声明，协议两侧没有握手。
- **全生命周期监控**：利用 **`TransformStream`** (Web Standard) 在 `Dispatcher` 层包装返回流（`pipeThrough`）。
  - **只有一个收尾钩子 `onClose(status, reason)`**（由 `@isdk/tool-func` 的 `createCallbacksTransformer` 提供），`status` 取 `'final' | 'error' | 'cancel'`：三种收尾路径全部汇到同一处，里面调 `handle.markStreamFinished()` 并按 `retention` 判定是否从 Tracker 除名。
  - **没有独立的 `flush` / `cancel` 钩子**：`TransformStream` 本身无 cancel 钩子，第三个参数按规范只读 `highWaterMark`/`size`，且 `flush` 在 cancel 时不跑。客户端侧的取消感知靠自建 `ReadableStream` 的 `underlyingSource.cancel`（`http-client.ts` 的 `cancelAware`）；HTTP 服务端侧靠物理连接的 `close`。
- **分片与重组（未实现，已拆出）**：分片序号重排与 RPC 层背压反馈属于 `RpcStreamReassembler` 的提案范围，**代码里不存在**（流以单条物理通道直传，无分片序号，背压只靠 Web/Node 流自身队列）。规格与开放问题见 `RFC_STREAM_REASSEMBLY.cn.md`，追踪条目见 `TODO.md`「流式（streaming）」。本节其余条目均为已落地实现。

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

      // 2. 架构层校验：调用 Manager 实例进行 SSRF/权限校验
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

实际实现（`ClientToolTransport.executeWithPolling()` / `pollTaskStatus()`）不是递归 `handleInterim`，而是循环 + 轮询内置工具：

```typescript
// 1) 首次调用拿到 102 后，按 rpc-retry-after 退避（默认 RPC_DEFAULTS.RETRY_AFTER_MS = 1000ms）
// 2) 轮询不是给原工具发 `rpc-act: status`，而是**改寻址到内置 `rpcTask` 工具**：
pollHeaders[RPC_HEADERS.TOOL_ID] = 'rpcTask';
pollHeaders[RPC_HEADERS.ACT]     = parentFetchOptions.act || 'get';   // 取消时是 '$cancel'
pollHeaders[RPC_HEADERS.RES_ID]  = taskId;                            // 原调用的 requestId
pollHeaders[RPC_HEADERS.REQUEST_ID] = 'poll-' + ...;                  // 每次轮询用全新 req-id
pollHeaders 删除 RPC_HEADERS.TIMEOUT;                                 // 轮询不受原死线约束
// 3) 本地 signal 触发时，fire-and-forget 发一次 act: '$cancel' 通知服务端注销后台任务
// 4) 循环直到状态不再是 102（完成返回结果，失败则抛错）
```

---

## 7. 兼容性与迁移策略

- **apiRoot 自动映射**：系统将其包装为 `http://localhost/apiRoot` 格式。
- **`ClientTools.setTransport(transport)`（已标 `@deprecated`）**：兼容层仍把实例注册至 `RpcClientTransportManager.instance` 全局单例（顺带调同样已废弃的
  `transport.mount(Class)`），行为不变。现行写法按地址寻：`Class.connect(apiUrl)` / `Class.apiUrl = apiUrl` 后 `loadFrom()`，
  transport 由 `getClient(apiUrl)` 按 scheme 自建（自定义协议先 `RpcClientTransportManager.bindScheme(scheme, Class)`）；
  必须自己构实例（mailbox 要 `clientAddress`）就 `instance.register(transport)` + `Class.apiUrl = transport.apiUrl`。
  废弃理由：往类上注入 transport 使类与物理通道耦合，同进程多实例时后者覆盖前者，且无法按调用选通道。
- **旧版参数桥接**：`elevateV1ParamsToV2Request` 确保写在 `params.id/act` 中的信息能被 V2 调度器正确识别。
- **发现端点（已修订）**：`addDiscoveryHandler(apiUrl, handler)` 已标 `@deprecated`——清单由内置工具 `rpcApis` 从**命中前缀**的注册表出，
  所以下游通常只需 `addRpcHandler(prefix)`。只有要自定义清单内容时才保留它（或自己注册一个工具再
  `addRoute(apiUrl, { path: '/', when: { method: 'GET' }, toolId: 'myListing' })`）。首次调用会打一次迁移提示（进程级，不刷屏）；
  基类仍**要求实现**该方法，所以自带路由表的后端不会被破。旧客户端（只发 `act: 'list' | 'get'`，不带 `toolId`）仍经内置行命中，行为不变。

---

## 8. 评估结论

本重构方案通过解耦物理传输与执行调度、引入显式的执行句柄追踪（Tracker）与多级死线控制（Guard），彻底解决了长耗时任务在分布式环境下的观测盲区与资源泄露风险。方案深度整合了 `tool-func` 原生异步特性，为 `@isdk/tool-rpc` 提供了工业级的安全性、确定性与跨协议管理能力。
