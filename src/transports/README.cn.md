# Tool-RPC V2 传输层架构指南 (详尽版)

欢迎使用 Tool-RPC V2 传输层。本模块提供了一套标准化、物理隔离、高性能且高度可观测的远程工具调用 (RPC) 基础设施，支持多种传输协议（HTTP/Mailbox）、流式响应、精细化的长任务保留策略及全链路安全审计。

---

## 1. 设计哲学与核心理念

V2 版本是对传输层的深度重构，旨在实现逻辑执行与物理通信的彻底解耦，提供工业级的资源管控能力。

### 1.1 协议中立 (Protocol Agnostic)

业务逻辑层（Dispatcher/Registry）不再感知底层的物理链路（如 Node.js 的 `IncomingMessage` 或 Mailbox 的 `MailMessage`）。所有物理请求在进入调度器前均被归一化为标准的 `ToolRpcRequest`。

### 1.2 资源导向寻址 (Resource-Oriented Routing)

引入 **资源 ID (resId)** 和 **动作 (act)** 的概念。

* 在 HTTP 传输中，这对应于 RESTful URL 模式：`POST /api/:toolId/:resId?act=:act`。
* 在 RPC 语义中，这解决了“一个工具 handle 多个相关联资源实例”的问题，而无需在 `params` 业务负载中混杂路由控制字段。

### 1.3 上下文驱动 (Context-Driven)

工具函数现在接收两个参数：`params` (业务负载) 和 `context` (`ToolRpcContext`)。

* **params**：纯净的业务数据，建议不含控制逻辑。
* **context**：包含 `resId`、`act`、`requestId`、`traceId`、`signal` (用于任务取消联动) 等。调度器确保 context 中的信息与物理请求头保持高度一致。

### 1.4 全生命周期可见性 (Visibility)

任务在执行函数 (`tool.run`) 启动前即完成在 `RpcActiveTaskTracker` 中的登记。这消除了长任务在“执行中但尚未超时”阶段的观测盲区，支持跨信道的实时状态查询与物理中止。

---

## 2. 核心数据结构定义

### 2.1 ToolRpcRequest (归一化请求)

这是传输层（Transport）传递给调度器（Dispatcher）的标准数据包。

```typescript
export interface ToolRpcRequest {
  apiUrl: string;      // 完整的 API 逻辑寻址 URL
  toolId: string;      // 目标工具或函数名
  act?: string;        // 动作指令 (Action)
  resId?: string;      // 资源唯一标识符 (Resource ID)
  traceId?: string;    // 全局链路追踪 ID
  requestId: string;   // 本次 RPC 的唯一请求 ID (必须全局唯一，用于冲突校验)
  params: any;         // 已解构的业务参数负载
  headers: Record<string, any>; // 归一化后的 Header 集合
  raw?: any;           // 物理层原生请求对象的逃生口
}
```

### 2.2 ToolRpcContext (执行上下文)

提供给工具函数在运行时获取元数据和控制信息的标准接口。

```typescript
export interface ToolRpcContext {
  requestId: string;
  traceId?: string;
  resId?: string;
  act?: string;
  headers: Record<string, any>;
  signal: AbortSignal;     // 核心信号：联动物理连接断开、硬超时及跨信道取消
  dispatcher: any;         // Dispatcher 实例引用，支持递归调用
  req?: any;               // [物理层透传] 原生请求 (如 http.IncomingMessage)
  reply?: any;             // [物理层透传] 原生响应对象
}
```

### 2.3 RpcError (标准错误处理)
为了确保错误能被正确序列化并在跨进程通信中完整还原，建议在工具函数中抛出 `RpcError`：
```typescript
// 构造函数: (message, code: number = 500, status?: string, data?: any)
throw new RpcError('Access Denied', 403, 'forbidden', { ip: '1.2.3.4' });
```
*   **`code` (数字)**：业务错误码。若在 100-599 范围内，将直接作为响应顶层的 `status`。
*   **`status` (字符串)**：可选的语义标识（方案一），如 `'teapot'`, `'invalid_params'`。
*   **`data` (对象)**：额外的结构化错误负载（方案三）。

---

## 3. 管理中心 (RpcTransportManager)

`RpcTransportManager` 负责传输实例的生命周期、地址映射与架构级策略校验。

### 3.1 核心职责与 API 详述

* **物理与逻辑解耦的路由归属登记 (Server Registration)**：
  * `registerServer(transport)`：在注册服务端实例时，Manager 会提取其物理底座声明身份 (`getListenAddr`) 与逻辑管辖路由 (`getRoutes`)，登记进路由归属表。反面是 `unregisterServer(transport)`（transport 侧对应 `registerRoutes()` / `unregisterRoutes()`）。旧名 `addServer` 已废弃（`add` 的反义词不是 `release`，那对动词不成对），保留一个版本的转发。
  * **路由冲突检测**：通过内部归属表校验，禁止在同一底座上重复注册完全相同的逻辑路由，从架构层面杜绝路由劫持风险。归属表的 key 是归一化后的前缀（见 8.1），地址 key 则是 transport 自报的 `getListenAddr()`——**不透明字符串，直接相等**。所以跨 transport 类能否对上 key，取决于两边报的地址形式是否一致：HTTP 报归一化后的 authority（`http://localhost:3000`），插件覆写 `getListenAddr()` 就要报同一形式（报得不一致是插件的 bug，框架不会去解析修正）。**不做包含关系预测**（不把 `0.0.0.0:3000` 视为覆盖 `localhost:3000`）：那种关系非传递（会漏报），又会把不同 host 同端口塌成一个底座（误报、vhost 判死）。真撞了由内核报 `EADDRINUSE`。
  * **路由从哪里来**：路由由 Transport 实例通过 `apiUrl` 内部派生并经 `getRoutes()` 声明，不是外部强制指定的。（客户端侧的 `transport.mount(ClientTools)` 是另一回事，属于 `ClientToolTransport`。）
* **bindScheme (协议绑定)**：
  * **静态绑定**：`bindScheme(['http', 'https'], HttpClient)`。将 Scheme 直接映射到具体的 Transport 类。
  * **动态解析器 (Resolvers)**：`bindScheme((scheme) => ...)`。支持注册函数，当静态注册表未命中时，动态判断并返回对应的 Transport 类。这在插件化系统中非常有用。
* **clearSchemes (注册表清理)**：`clearSchemes(scheme?)`。支持清除全部或特定协议的注册信息，主要用于单元测试环境下的状态隔离。
* **实例缓存与复用**：Manager 会根据 `apiUrl` 的 **Origin (协议+域名+端口)** 路径自动缓存 Transport 实例。这意味着对同一个服务端不同路径的调用将共享同一个物理连接池，实现资源复用。
* **架构级策略校验 (validateRpcRequest)**：
  * **SSRF 防御**：通过 `addRestrictedPattern` 注入正则或字符串模式（如 `localhost`, `127.0.0.1`），Manager 会在分发前拦截非法地址请求。
  * **钩子重写**：允许通过继承 Manager 并重写此方法来实现自定义的全局策略校验。
* **审计钩子 (onRequestRejected)**：被流水线拒掉的请求都进这里（身份策略 401、`validateRpcRequest` 的
  SSRF/白名单 403、寻址失败），默认 no-op，继承覆写（issue #10）。
  它存着是因为两个钩子不在同一层、也不在同一时刻：`validateRpcRequest` 跑在身份判定**之后**，
  所以被 401 拒掉的请求根本走不到它——而拿钩子当日志的部署最想记的恰恰是这批失败尝试。
  钩子自己报错不会掉响应（审计失败不该把 401 变成 500）。
* **生命周期管理**：
  * `startAll()`：批量启动所有已注册的服务端 Transport。
  * `stopAll()`：优雅关闭所有实例。由于 HTTP 层引入了引用计数，此操作会根据使用情况自动关闭物理 Server。

### 3.2 实例化与管理范例

```typescript
import { RpcTransportManager, HttpServerToolTransport } from '@isdk/tool-rpc';

const manager = RpcTransportManager.instance;

// 1. 注册服务端传输层
const server = new HttpServerToolTransport({
  apiUrl: 'http://0.0.0.0:3000/api'
});
manager.registerServer(server);

// 2. 批量启动与统一清理
await manager.startAll();
// ... 业务运行 ...
await manager.stopAll();
```

---

## 4. 调度引擎 (RpcServerDispatcher)

`RpcServerDispatcher` 是服务端的核心流水线，将请求处理分为五个清晰阶段：

### 4.1 模块化执行流水线 (Dispatch Pipeline)

调度器内部将请求处理拆分为五个清晰的阶段，确保每个步骤都可被观测和干预：

1. **Resolution (寻址)**：根据 `toolId` 查找工具（优先用户 Registry，后回退至系统 Registry）。同时执行路由信息（`act`/`resId`）的提升逻辑（从 Header 或兼容 Params 提取）。
2. **Preparation (准备)**：执行超时协商，构建归一化 `ToolRpcContext` 和 `AbortController`。
3. **Execution (执行)**：调用工具函数，获取业务 Promise。
4. **Tracking (注册)**：**立即登记**任务至 `RpcActiveTaskTracker`。
    * **409 Conflict 校验**：若 `requestId` 已在账本中激活（正在运行中），则直接返回 409 错误，防止非幂等操作的重复触发。
5. **Waiting (等待)**：处理两级死线控制。若任务超时但开启了挂起模式，则返回 102 信号。

### 4.2 即时清理机制 (Immediate Cleanup)

这是 V2 的重要性能优化：在 `dispatch` 响应返回后，系统立即根据任务的 `retention` 策略评估其是否符合回收条件。

*   **常规任务**：若符合条件（如策略为 `None`），响应返回后立即移除。
*   **流式响应**：清理评估将**自动延迟**。Dispatcher 挂在流上的 transformer 只接得到 `flush`（正常结束）——`TransformStream` 本身**没有** cancel 钩子：第三个参数 `readableStrategy` 按规范走 `ConvertAndNormalizeQueuingStrategy`，只读 `highWaterMark`/`size`，传 `cancel` 会被默默忽略（Node 22 实测不触发），`flush` 在 cancel 时也不跑。所以「下游取消」这条路由别处兜：HTTP 侧靠物理连接的 `close`（`stream-lifecycle.test.ts`），客户端侧靠自建 `ReadableStream` 的 `underlyingSource.cancel`（`http-client.ts` 的 `cancelAware`，规范保证会调）。要在新 transport 里接 cancel，只有后者这一条路。

---

## 5. 任务追踪与保留策略

### 5.1 任务保留模式 (RpcTaskRetention)

用户可针对每个工具精细化配置其完成后的状态保留行为：

* **`None` (0)**：任务结束后立即销毁（默认）。
* **`Permanent` (-1)**：永久保留结果，除非手动删除或进程重启。
* **`Once` ('once')**：**保留至获取即销毁**。结果会驻留在内存中，直到客户端第一次通过 `rpcTask.get()` 成功取回结果后立即清理。
  * **兜底清理**：支持 `onceFallbackMs`（默认 1 小时），防止因客户端异常失联导致的内存泄露。
* **`number` (ms)**：任务完成后保留指定的时长。
* **`maxRetentionMs`**：系统全局硬上限，无论设置何种模式，超过此时间必须被物理回收。

### 5.2 任务句柄 (RpcActiveTaskHandle) 的流联动
当 `tool.run` 返回一个 Web `ReadableStream` 时：
1.  Dispatcher 调用 `handle.setOutputStream(stream)` 将流绑定到任务。
2.  Handle 的 `streamPending` 标记变为 `true`。
3.  此时，即使调用 `aborter.abort()` 也会联动调用 `stream.cancel()`，确保物理资源被正确释放。

### 5.3 系统工具 `rpcTask` 与 `rpcApis`

`rpcTask`：内置的任务管控接口，符合 REST 规范：

* **状态查询**：`GET /api/rpcTask/:requestId`。返回 102 (运行中)、200 (已完成并带结果) 或 500/408 (错误/中止)。
* **任务取消**：`POST /api/rpcTask/:requestId?act=$cancel`（物理中止）。

`rpcApis`（`RpcApisResource`，id 常量 `RPC_APIS_TOOL_ID`）：内置发现工具，就是发现端点的实现：

* **列清单**：`GET <前缀根>`（Mailbox 侧是无 `toolId` 且 `act: 'list' | 'get'`）。它从 `ctx.registry` 取
  **本次命中前缀**的注册表，所以多前缀多注册表时各列各自的工具；它**不声明** `timeout`，
  因此和其他工具一样受 `globalTimeout` 管（发现调用该被超时掉，issue #8）。
* **注册表形态不限**：会 `toJSON()` 的层用它（多层会合并，与 `get()` 同一套优先级），不会的按
  静态 `items`（ToolFunc 家族）/ `entries()`（Map 形状）/ 自有键（普通对象映射）枚举。
  规则只有一套：`get()` 解析得到的工具，清单里就必须有它——不能回 `200 {}`。*   **清单默认不带函数体**：`ToolFunc.toJSON()` 会把 `func` 序列成源码字符串，所以框架在取用条目时
  默认剥掉 `func`（与 `ServerTools.toJSON()` 同一套规则）；`allowExportFunc: true` 才是显式导出，
  客户端拿到后本地执行。剥在副本上，不会抹掉服务端工具自己的 `func`。
  这条规则由框架对**每一条**交出去的条目执行，包括注册表自带 `toJSON()` 交上来的那些（issue #9）：
  清单形态归注册表定，要不要发布函数体不归它定。
* **不是旁路**：它与业务工具同在一个 `systemRegistry`、走同一条流水线（路由表解析 → 身份判定 →
  `validateRpcRequest` → dispatch）。要换掉它：在自己注册表里注册同名 `rpcApis`（业务表优先于系统表），
  或 `addRoute()` 声明同一路由行。

---

## 6. 标准 Header 与协议规范

| Header 常量 (`models.ts`) | 物理键名 | 说明 |
| :--- | :--- | :--- |
| `RPC_HEADERS.TOOL_ID` | `rpc-fn` | 目标工具名称 |
| `RPC_HEADERS.RES_ID` | `rpc-res-id` | 资源实例 ID |
| `RPC_HEADERS.ACT` | `rpc-act` | 方法动作 (Action) |
| `RPC_HEADERS.TRACE_ID` | `trace-id` | 链路追踪 ID |
| `RPC_HEADERS.TIMEOUT` | `rpc-timeout` | 业务执行超时声明 (ms) |
| `RPC_HEADERS.REQUEST_ID` | `req-id` | 响应中必须回显的唯一请求 ID |
| `RPC_HEADERS.RETRY_AFTER` | `rpc-retry-after` | 102 响应里的轮询退避间隔（默认 `RPC_DEFAULTS.RETRY_AFTER_MS` = 1000ms） |
| `RPC_HEADERS.CLIENT_ID` | `rpc-client-id` | 客户端自报标识（装了身份策略后由服务端判定值接管） |
| `RPC_HEADERS.FUNC` | `rpc-fn` | **@deprecated** 别名，用 `TOOL_ID` |

> 没有 `rpc-priority` 这类头（优先级未实现）；`trace-id` / `req-id` 也没有 `rpc-` 前缀，拼 header 时直接用常量。

---

## 7. 状态码语义对照表

响应顶层的 **`status`** (数字) 决定了物理协议的行为及客户端的基础判定：

| 状态码 | 语义 | 描述 |
| :--- | :--- | :--- |
| **200** | OK | 执行成功并返回结果。 |
| **102** | Processing | 响应超时，任务已转入后台。建议客户端开始轮询。 |
| **400** | Bad Request | 参数错误或能力协商失败。 |
| **401** | Unauthenticated | 身份策略拒绝：凭证缺失或验不过（见 §9）。 |
| **404** | Not Found | 找不到工具或任务 ID 已失效。 |
| **408** | Terminated | 触及硬死线，业务已被服务端强制中止。**仅出现在轮询路径**（`rpcTask.get` 读到 `aborted` 任务）与账本内部的 `RpcError`；同步调用的硬死线会被 `handleError()` 映射为 504。 |
| **409** | Conflict | 同样的 `requestId` 正在运行中，拒绝重复提交。 |
| **413** | Payload Too Large | 请求体超过 `maxBodySize`（默认 1MB）。由 **HTTP 传输层**直接回，不在 `RpcStatusCode` 枚举里。 |
| **500** | Error | 业务代码执行抛出异常。 |
| **504** | Gateway Timeout | 响应超时（含客户端本地计时器到期，以及硬死线 `RpcError(408)` 的映射结果），`error.status` 为 `'timeout'`。 |

> **注**：若 `RpcError.code` 在 100-599 范围内，系统将自动将其映射为顶层 `status`。

---

## 8. 传输层实现细节

### 8.0 传输层 helper：只有两个文件

本节说的是**传输层 helper**：写 transport 时可复用的纯函数规则库（与 `ServerTools` / `RpcMethodsServerTool` 那些工具基类无关，也与**监听底座本身**无关——那是下一节的事）。写一个新 transport 时，可复用的传输层 helper 只有两个文件，各回答一个问题：

> 本节旧称「传输层基座 API」，已改称 **helper**；分层与用词见 `CONTRIBUTING.md` 的「本包的分层」。

| 文件 | 回答 | 适用于 |
|---|---|---|
| `route-path.ts` | **哪条路由**：前缀规范化（以 `/` 开头、去尾斜杠、根为 `/`）、重叠判定 | 任何按 path 挂载的插件，与协议无关 |
| `socket-address.ts` | **哪个 socket**：`socketAddressFromBind()`（监听前，apiUrl + bind 参数 → 地址 URI）、`normalizeSocketAddress()`（写法规范化，监听前后的观测值也过它）、`normalizeListenBind()`（`BindOptions` 解析：socket 三别名、socket 优先于 host/port）、`unixSocketUri()` | 监听 TCP / unix socket 的 transport（本包的 HTTP；外部包 `@isdk/tool-rpc-fastify`；以后的 Express/Hono/WS） |

- **名字里的 socket 指「监听底座」**（TCP socket 或 unix socket 文件），不是「只能 unix」：HTTP 只是同一个底座的其中一个写法家族。
- **监听前后两个时刻不可合并**：`socketAddressFromBind()` 在 listen **前**推声明地址（`port: 0` 时端口是假的）；listen **后**要把内核观测值过 `socketAddressFromListen()`（本包的 HTTP 拿的是 Node `server.address()`；外部包 `@isdk/tool-rpc-fastify` 拿的是 Fastify `listen()` 的返回值，形状不同，由同一个函数区分）。两边必须算出同一个字符串，否则同一个 socket 在池里会有两个 key。
- **物理底座不在 helper 里**：`sharedServers` 池 / refCount / 最长前缀分发表属于 `http-server.ts`。helper 只处理字符串与参数，不碰监听对象。
- **L0 不读 bind**：`ServerToolTransport.start(options?)`（`src/transports/server.ts`）只做三件事：把 `this.options` 深合并进参数、按当前地址 `registerRoutes()`、`return this._start(options)`。基类从不读 bind 字段去算地址，`getListenAddr()` 对它只是个不透明值。所以 helper 是**可选规则库**：mailbox transport 读 `options?.address`（总线名）、electron 的 `_start()` 无参，两者都不碰 `socket-address.ts`。`defaultBindOptions()` 也不在基类，只有监听 TCP/unix 的 transport 各自定义。
- **为什么 `BindOptions` 不单独成文件**：`BindOptions`（调用方声明这一轮怎么监听）与 `socket-address.ts`（这一轮落在哪个地址）是同一件事的两半，`socketAddressFromBind()` 就是从前者算后者。拆开就会两边各读一遍 bind，声明地址与真实监听就会错开。

#### 参考实现：本库自带的 transport

本包自带的物理 transport 都是最基础的那几个，它们就是 transport 开发者的**参考实现**：同一个规则只写一处、地址只从 helper 算、物理底座自己拥有。

| transport | 底座 | 参考什么 |
|---|---|---|
| `HttpServerToolTransport`（`http-server.ts`） | TCP + unix socket | 底座池 + refCount + 最长前缀分发；监听后把观测值换进池 key（`port: 0`） |
| `MailboxServerTransport`（`mailbox-server.ts`） | 信箱总线 | 不碰 `socket-address.ts`：`_start()` 读 `options?.address`，`getListenAddr()` 直接报总线名 |
| `HttpClientToolTransport` / `MailboxClientTransport` | 客户端侧 | 客户端 transport 契约（含 `mount(ClientTools)`） |

写新 transport 时先照 `mailbox-server.ts`（最简单，无物理底座）启个框架，需要监听 TCP/unix 再对照 `http-server.ts`。

「参考实现」意味着抄它的人会抄走每一条隐含约定。下面这几条以前在这两个文件里是**破的**（抄过去就是复制缺陷），现在已修并被回归测试钉住，改这两个文件时不要退回旧写法：

| 约定 | 旧写法错在哪 | 钉住它的测试 |
|---|---|---|
| 源流错误必须处理：`result.pipe(res)` 之外要接 `result.on('error')` | 只接了 `res.on('error')`，源流抛错变成未捕获异常，响应挂死到超时 | `http-server-regressions.test.ts` R4 |
| 请求体按**字节**收集（`Buffer` 拼接后一次 `toString('utf8')`），`maxBodySize` 也按字节判 | `body += chunk.toString()` 在多字节字符跨 chunk 时静默损坏成 U+FFFD，还照样回 200；按字符数判会超发 | R5、R6 |
| 回环判定用归一化地址（`normalizeSocketAddress`）解析出的 hostname，不用 `/localhost/i` 扫字符串 | `mylocalhost.example` 这种 vhost 被误判回环，于是绑到 `127.0.0.1`，外部访问不到 | R1、R1b |
| `start()` 每轮都补齐本实例声明的路由，不用 `some()` 提前短路 | start 之后新增的路由第二次 start 也不注册 | R2 |
| `options` 里继承来的 `http.ServerOptions` 要转交 `http.createServer` | `maxHeaderSize`/`keepAliveTimeout` 等静默失效 | R3 |
| `stop()` 必须注销路由归属（`unregisterRoutes()`） | mailbox 侧 stop 后地址永久占位，下一个实例 `registerServer` 必报 `Routing Conflict` | `mailbox-server.test.ts`、`routing-regressions.test.ts` P12 |
| 路由前缀归一化只从 `route-path.ts`（基类 `toPathname`）走，不在子类里另写一份 | mailbox 自写 `extractPath`，`new URL` 失败就退回 `'/'`：裸前缀声明全塌成根，`/y` 与 `/z` 被当成重复声明拒掉 | `mailbox-transport.test.ts`、`mailbox-server.test.ts` |

> **Fastify 不在本包里。** `FastifyServerToolTransport` 属于**另一个仓库、另一个包** `@isdk/tool-rpc-fastify`（不是本库内置插件）。本包文档不描述它的实现细节，只保证 helper 两边共用同一份；fastify 侧的约定（自己的观测形状、`defaultBindOptions()`、共享同一个 fastify 实例）写在 `tool-rpc-fastify` 自己的 README 里。

#### 公开面判据：下游在用，或插件契约

地址符号对外与否，两条判据（可 grep）：

```shell
grep -rn '\b符号名\b' ../tool-rpc-fastify/src ../tool-electron/src ../ai-tool/src ../tool-event/src
```

1. 命中 → 公开（下游在用）。
2. grep 不到但是**插件契约**（写自定义 transport 时要拿它算 `getListenAddr()` 该报什么）→ 也公开。
3. 两条都不命中 → 包内。

| 下游在用 | 插件契约 | 包内 |
|---|---|---|
| `BindOptions`、`normalizeListenBind`、`socketAddressFromBind`、`socketAddressFromListen` | `ResolvedListenBind`（`normalizeListenBind` 的返回类型，必须可命名）、`normalizeSocketAddress`、`normalizeHostAndPort`、`unixSocketUri`、`unixSocketPath` | `hasUriScheme`、`nativeAddressFromBind`、`withBindOptions`、`normalizeNativeAddress` |
| `normalizeRoutePath`（按 URL 寻址的 transport 都要它：`tool-rpc-fastify` 在用） | `RoutePathError`、`NormalizedRoutePath`、`RoutePathOptions`（`normalizeRoutePath` 的错误与返回类型，必须可命名） | `routeMatchKey`、`matchRoute`（读的是基类自己的 `routeTable`，覆写者拿不到也不该拿） |

路径归一化只有 `normalizeRoutePath` 一个入口，它存在的理由就是消灭「四处各自实现、规则互不一致」（`%2F` 算不算分隔符、`//` 是否折叠、`.`/`..` 是否消解、尾斜杠算不算不同路径）。所以适配器**不得**从框架自己的 params 反推路径（find-my-way 会把 `%2F` 解成分隔符、把 `//` 分成两段、对 `x/..` 直接 404）——那正是这个模块要修的 bug 再长回来。

名单在 `transports/index.ts` 与 `transports/browser.ts` 里是**显式**的（不是 `export *`），由 `test/browser-entry.test.ts` 钉住。改公开面时**先改那份名单**（它会红）再动代码：它是唯一能表达「这个符号不该公开」的机制——测试网钉得住行为，钉不住公开面。

### 8.1 HttpServerToolTransport
*   **物理底座复用 (Physical Reuse)**：支持多个逻辑 Transport 实例共享同一个物理端口（Node.js `http.Server`）。静态池只按 `getListenAddr()` 的字符串精确匹配：相等就复用同一个 server，不相等就各自 `listen()`，真撞了由内核报 `EADDRINUSE`。不做「通配覆盖具体 host」那种包含判断（非传递、会漏报，又会把不同 host 塌成同一个底座）。
*   **地址跟着监听走**：`getListenAddr()` 在监听前是声明值（apiUrl + `start({ host, port, path })`），监听后是真实底座——`port: 0` 时只有内核知道端口，地址必须是「能被别人访问」的那个。地址定下来后调 `registerRoutes()` 重登归属。apiUrl 是裸 path 前缀（只说了路由、没说底座）时，由 bind 参数加上传输层 `defaultBindOptions()` 的确定默认值**造**出底座 URI，于是 `/api` 与 `/v2` 两个实例能共用同一个 socket 而不是各自 EADDRINUSE。
* **地址归一化 (`normalizeSocketAddress`)**：地址语义属于 HTTP transport，不在通用 URI 模块里。`http://localhost:3000`（精确绑定）、`http://*`（通配监听）；只规范化「同一个 socket 的两种写法」：回环别名（`127.0.0.1` / `[:]`）归一为 `localhost`，通配写法（`0.0.0.0` / `[::]` / `*`）归一为 `*`，默认端口由 URL 自身丢弃（`http://h:80` 与 `http://h` 同 key），无 scheme 的 `host:port`（绑定观测、legacy 写法）补 `http://`。具体 host 不塌成通配（否则 vhost 判死）。
*   **Host 头归一**：Host 是客户端可控输入，会被拼进 `ToolRpcRequest.apiUrl` 喂给 SSRF 校验（`url.includes(pattern)` 式匹配），所以先过归一（小写、去末尾点、去默认端口）：不归一的话 `Host: LocalHost` 能绕过针对 `localhost` 的限制。
*   **unix socket 底座**（本节属 `HttpServerToolTransport`：unix socket 是这个 HTTP transport 自带的监听模式，不是独立插件，所以 `unix:` 这种地址形式也在这里说——它是 `getListenAddr()` 会报的底座 key，不是另一套 API）：`start({ path })`（也认 `socketPath` / `socket`）监听 unix socket，`getListenAddr()` 就是 `unix:<path>`。`unix:` 之后按 URI 规范处理：入参**先按段 percent-encode 再进 URI**，要原值用 `unixSocketPath()` decode（空格→`%20`、`#`→`%23`、字面 `%`→`%25`、非 ASCII→UTF-8 百分号序列）。词法归一（折叠 `//`、去尾斜杠、消 `.` / `..`）在**已编码**空间做，所以 `/` 只作分隔符、段内 `%2F` 是字面斜杠。两条不变量：`unixSocketPath(canonical)` 就是实际 listen 的路径；编码幂等且单射——`/tmp/a b.sock` → `unix:/tmp/a%20b.sock`，而 `/tmp/a%20b.sock` → `unix:/tmp/a%2520b.sock`，两个可共存的合法文件名不会塌成同一个 key（塌了会误报冲突、还会复用错 socket）。注意带 `unix:` 前缀的入参按已编码理解：`unix:/tmp/a%20b.sock` 指的文件是 `a b.sock`，字面叫 `a%20b.sock` 的要写 `unix:/tmp/a%2520b.sock`。socket 声明优先于 host/port（与 Node「有 port 就忽略 path」相反，否则声明身份与真实监听会错开）。库默认不删 socket 文件（Node 的 `close()` 不删），重启到同一路径需调用方先清掉旧文件。同一 socket 上重复挂载同一逻辑路由会被 Manager 报 `Routing Conflict`；不同 socket 文件就是不同底座。
*   **精准路由分发 (Longest Prefix Match)**：当物理端口接收到请求时，采用“最长前缀匹配”算法扫描逻辑实例。
*   **路径规范化 (Canonical + Trailing Slash)**：逻辑路由（`getRoutes()`）以 canonical 形式声明——以 `/` 开头、不带尾随斜杠（根为 `/`）；写入物理分发表的 key 由基类 `toMatchPrefix()` 补尾随斜杠，保证 `/api` 不会误匹配 `/apix`。归一化与匹配 key 均由 `ServerToolTransport` 的 helper 统一派生，实现方不再手写字符串拼接。
*   **多前缀与重复声明 (Route Claims + Remount)**：`addRpcHandler()` / `addDiscoveryHandler()` 通过基类 `claimRoute()` 登记前缀，同一实例可服务多个前缀，各自的 registry / discovery handler 互不覆盖（请求期按前缀解析）。对已声明前缀再次声明时，默认 `'replace'`（替换并告警，不重复注册物理路由）；传 `options.remount = 'throw'` 则经 `onDuplicateRoute()` 抛错，自带路由表的后端可覆写该钩子以上报框架原生错误。`addDiscoveryHandler()` 已 **@deprecated**（发现端点由内置 `rpcApis` 回答，见下条）：基类仍要求实现它，但首次调用会经 `warnDiscoveryDeprecated()` 打一次迁移提示（进程级 flag，不刷屏），只有要自定义清单内容时才保留它。
*   **路由表 (Route Table)**：每个前缀还带一张「前缀内路径 → 工具寻址」的表：`addRoute(apiUrl, { path, when: { method?, act? }, toolId, act })` 声明，`getRouteTable()` 读出（含内置行），适配器可拿去自己框架里原生注册。内置发现端点就是表里的普通行（`GET 前缀根` 与 `act: 'list' | 'get'` 都指向 `rpcApis`），第三方用同一路径同条件声明就能换掉它——没有特权通道。`path: ''` 与 `'/'` 同义（都归为前缀根）；`/x` 与 `/x/` 默认同义（`strictTrailingSlash: true` 才分两条）；`when.method` 声明侧大小写不敏感（`addRoute` 存进表时归成大写，匹配用的也是大写值）。
*   **引用计数管理 (Ref Counting)**：逻辑实例通过引用计数自动控制物理 Server 的生命周期，实现“最后一人离开时关灯”。
*   **寻址优先级**：Header 显式指令 > URL Path 降级解析 (`/api/tool/resId`模式)。
*   **HTTP 102 信号映射**：由于多数现代 fetch 工具（如 `undici`）对 1xx 信息性状态码的处理存在不确定性，V2 在物理层将 `102 Processing` 逻辑映射为 **`202 Accepted`**，并返回包含任务 ID 的 Body 负载，确保客户端能稳定解析。
*   **物理连接联动与资源清理**：
    *   HttpServer 会监听原生响应对象的 `close` 事件。
    *   一旦物理连接非正常断开（如客户端关闭浏览器或网络中断），Transport 会调用 `handle.abort('Physical connection closed')`。
    *   这会触发流的 `cancel` 和业务逻辑的 `AbortSignal` 联动，确保服务端不会继续执行已无受众的任务。
*   **流式背压**：原生支持 `ReadableStream` 管道透传，通过 `Readable.fromWeb` 桥接至 Node.js 网络层。

### 8.2 MailboxServerTransport
*   **物理独占性保护**：由于 Mailbox 协议通常基于点对点地址，该 Transport 默认接管物理地址下的全量路径 (`/`)。在 Manager 的路由归属登记下，这确保了对特定 Mailbox 地址的物理独占，防止多实例对同一信箱地址的争抢。
*   **元数据注入**：自动在 context 中注入 `x-mailbox-from/to` 等追踪头信息，增强全链路观测性。
*   **信号联动**：支持 `push` (订阅) 和 `pull` (轮询) 两种模式，适配不同的信箱底座。一个地址上两者**只能选一种**：memory provider 的 `publish()` 以前既投递给监听器又入队，而 push 消费者从不 dequeue —— 队列按调用次数永久堆积，重新 `start()` 时 `drainBacklog()` 还会把已处理过的请求再执行一遍（副作用重复）。现在 provider 侧有 push 订阅者就只走 push；契约钉在 `mailbox/src/mailbox.test.ts` 与 `mailbox-transport.test.ts`（「push 模式不重复记账」）。注意 `MemoryEventBus` 是进程内单例，topic 跨 `Mailbox` 实例共享，测试里地址必须唯一。

### 8.3 监听地址不变量（写 transport 要守的规则）

服务端 transport 只有一个地址概念：`getListenAddr()` —— 别人访问本服务用的地址。框架把它当**不透明字符串**：只用作底座池 key、路由归属表 key、分发 key 与日志，不解析、不校验、不预测 bind 冲突。签名是 `string | string[]`（`src/transports/server.ts`）：一个实例同时监听多个地址就报多个，Manager 在 `src/transports/server-manager.ts` 摊平成逐地址登记，仍然一个字符串一个 key。

- 地址语义（host/port/socket、回环写法、默认端口、监听之后补真实端口）归按 scheme 分派到的那个 transport 自己管；HTTP 家族那套在 `socket-address.ts`。插件只需覆写 `getListenAddr()` 返回一个字符串（`unix:/run/ai.sock`、`mem://bus-a`）。
- 基类默认返回 `apiUrl` 原值。覆写后报什么就是什么：两个 transport 报的字符串**相等就复用同一个底座**，**不相等就各自 `listen()`**，真撞了由内核报 `EADDRINUSE`（fail fast，不误报也不漏报）。**不做包含关系预测**（不把 `0.0.0.0:3000` 视为覆盖 `localhost:3000`）：那种关系非传递（会漏报），又会把不同 host 同端口塌成一个底座（误报、vhost 判死）。
- 地址变了（`start({ port })` 改写、`port: 0` 观测到真实端口）时要调 `this.registerRoutes()` 重登归属，否则登记停在旧地址上：对真实地址漏报、对让出去的地址过报冲突。每次 `start()` 重算声明地址，不累加。
- socket 别名与「socket 优先于 host/port」**只写一处**：`normalizeListenBind()`。`socketAddressFromBind()` 造声明地址时用它，transport 的 `_start()` 取监听参数时也用它。两边不同一份，声明地址与真实监听就会错开。
- 监听前后的地址必须相等（同一个 socket 在池里只能有一个 key）：声明侧 `socketAddressFromBind()`、观测侧 `socketAddressFromListen()`，两边都过 `normalizeSocketAddress()`。

#### 为什么 unix 路径要按段编码

8.1 给了规则（先按段 percent-encode 再进 URI，词法归一在已编码空间做）。为什么只能这样切（均实测）：

| 做法 | 结果 |
|---|---|
| `new URL('unix:/tmp/a b.sock')` | pathname `/tmp/a%20b.sock`，但字面 `%` 原样保留 → `/tmp/a b.sock` 与 `/tmp/a%20b.sock`（两个可共存的合法文件）塌成同一个 key；`#` / `?` 在 parse 阶段截断 pathname（`/tmp/a#b.sock` → pathname `/tmp/a`），那不是编码、无从 decode |
| 整段 `encodeURIComponent(path)` | 分隔符也被编掉：`/tmp/a b.sock` → `%2Ftmp%2Fa%20b.sock`，底座层级没了 |
| `encodeURI(path)` | 它按**整个 URI** 的转义集，刻意保留 `;/?:@&=+$,#`。喂给单个段就等于不转义 `#` / `?` → pathname 仍是 `/tmp/a` |
| **按段 `encodeURIComponent`**（采用） | 空格→`%20`、`#`→`%23`、`?`→`%3F`、字面 `%`→`%25`、非 ASCII→UTF-8 序列；`/` 由切分保留为分隔符，段内出现的 `%2F` 只可能是字面斜杠，两者可区分 |

另外：`decodeSegment` 把裸 `%` 先当 `%25`（`/tmp/%.sock` 里 `%` 不是合法转义序列，直接 `decodeURIComponent` 会抛 URIError）；词法消 `.` / `..` 是**文件系统**语义，`/../x` 在根上夹住成 `/x`（POSIX），不像 HTTP 请求路径那样报 400（对比 `route-path.ts` 的 mode）。

### 8.4 transport 测试与环境坑

- **改 `packages/mailbox` 的源码后要先重建 `dist`**。本包测试里 `import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox'` 解析到的是 `packages/mailbox/dist/index.js`（workspace 软链 + `main` 字段），不是 `src`。只改源码不跑 `tsup`，下游测试看到的仍是旧行为（会误判「修复无效」或「测试假绿」）。
- **端口不要先探测再 bind**。`findPort()` 是「探测 → 关闭 → 交给被测代码 bind」，中间有 TOCTOU 窗口；它内部的串行与递增重试只在**单进程**内有效，而 vitest 每个测试文件跑在独立 worker 里，两个套件从同一个起始端口出发就会同时认为它空闲，后 bind 的那个随机 `EADDRINUSE`。
  - 只需要「一个可用端口」时：用 `test/helpers/ports.ts` 的 `startOnKernelPort()`——`port: 0` 由内核在 listen 时原子分配，没有窗口；端口从 `getListenAddr()` 读。路由要在 start 前声明，所以用**裸 path 前缀**（`/api`）声明路由，端口等监听后再拼给客户端。
  - 确实需要预先知道端口时（例如两个 transport 要在 apiUrl 里写同一个 authority 才能落到同一底座）：用 `test/helpers/ports.ts` 的 `withReservedPort(from, factory, host?)`。它把探测与 bind 之间的窗口压到 factory 自己的 setup，且窗口内真被抢走时**换下一个号码重跑 factory**。
    - factory 必须可重跑，且只放「构造 transport + 监听」；它的**返回值**就是 `withReservedPort` 的返回值（要拿端口就在末尾 `return p`）。`_start` 失败时会把脏底座从共享池删掉（`sharedServers.delete(key)`），换号重跑不留残留。
    - 只有第一个真的 `listen` 的实例需要预留；挂到同一底座上的后续实例走 refCount，不会再 listen。
- unix socket 文件：Node 的 `close()` **不会**删除 socket 文件，重启到同一路径要先清掉旧文件。测试里用唯一临时路径 + `finally` unlink。（外部包 `@isdk/tool-rpc-fastify` 不同：Fastify 自己的 `close()` 会删。）
- socket 路径有长度上限（Linux 约 104 字节），临时目录名要短。
- 底座是引用计数的共享池：测试里 start 出来的第二个 transport 若没 `stop()`，`stop(true)` 也不会关掉 server，进程会挂住不退出。

---

## 9. 身份策略（服务端运行时）

回答一个问题：**这个请求是谁**。三个文件，都在 `src/transports/` 下（browser-safe 边界与装配入口在 transport 上）：

| 文件 | 内容 |
|---|---|
| `identity.ts` | 抽象：`RpcIdentity` / `RpcIdentityContext` / `RpcCredentialReader` / `RpcCredentialSource` / `RpcIdentityPolicy` / `RpcCredentialRegistry`，零实现 |
| `identity-session.ts` | 默认实现 A：`RpcSessionIdentityPolicy`（服务端自签发会话凭证）+ `RpcInProcessCredentialRegistry` |
| `identity-bearer.ts` | 默认实现 B：`RpcBearerPolicy`（凭证外部签发，服务端只验） |

完整规格（契约、差异表、继承规矩、分期）在根目录 `IDENTITY_POLICY_DESIGN.cn.md`。本节只写 transport 开发者要守的东西。

**判定只有一套**：`ServerToolTransport.resolveRequestIdentity`，插在 `processIncomingCall` 的
`toRpcRequest` 之后、`manager.validateRpcRequest` 之前；内置发现工具也是普通工具，所以它没有第二个入点（见下面第 6 条）——插在这里，Manager 的 SSRF / 拦截钩子才能看到
`request.identity`。构造选项 `{ identity, credentialReader }`，**没传就是 no-op**，基类不启用任何身份逻辑，
行为与不装策略的部署逐字节一致。`protected` 可覆写（非 HTTP 协议要换 ctx 备料方式时才需要）。

**适配器要自己把发现端点接进这条流水线**：判定只长在 `processIncomingCall` 里。若适配器为清单手写一条
`GET <前缀>` 路由（不经它），清单就绕过身份与校验——业务 API 要凭证、工具清单却匿名可取。按
`getRouteTable()` 逐条注册就不会漏（本仓 issue #4：`tool-rpc-fastify` 就踩在这里，修在 isdk/tool-rpc-fastify.js#1）。

框架侧备的 `ctx`：`credential`（reader 取出的）/ `headers`（已归一化）/ `prefix` / `apiUrl`，加寻址结果 `toolId` / `act` / `resId`、
注册表里那个**只读工具实例** `tool`，再加 `req`/`res` 逃生口。`tool` 按 dispatcher 的解析顺序取
（前缀 claim 的 registry → transport 自己的 → dispatcher 的 → 系统保留层），取不到就是 `undefined`——工具不存在由 dispatcher 报 404，
身份这一步不抢它的活；框架保留工具（`rpcTask` / `rpcApis`）不在业务注册表里，要单独判定它用 `ctx.toolId`。
框架侧**只调接口**：不 `instanceof`、不按 `name` 匹配、不读策略内部、不缓存返回值；三个钩子（`match`/`assign`/`revoke`）
一律 `await`。状态（登记表、TTL、计数器）、凭证怎么生成校验、凭证在 wire 上的位置与下发通道，全在策略内
（交付句柄是 `ctx.res`，框架侧不定义凭证的 header 名）。

写 transport 时要守的七条：

1. **凭证取法归 transport**：`credentialReader` 从原生 req 取一个字符串。内置默认只读标准字段 `authorization`
   （去 `Bearer` 前缀）；私有 header（鉴权代理、Electron payload、EventSource 的 query）由部署写自己的 reader。
   HTTP 与 Mailbox 的原生请求都带 `headers`，所以默认 reader 直接覆盖两者。
   它备进 `ctx.credential` 的同时要标上 `ctx.credentialRead = true`：**reader 权威**——它返回
   `undefined` 就是「这个请求没带我要的凭证」，策略不能回头自己读 `authorization`（否则部署明确
   不信的凭证来路仍会被用，issue #3）。`credential === undefined` 与「没人读过」必须分得开，
   这就是 `credentialRead` 存在的理由（策略单独用时两个字段都没有）。
2. **采信什么由策略决定**：客户端自报的 `clientId` 在 `ctx.headers[RPC_HEADERS.CLIENT_ID]`，不在 `ctx` 顶层；
   基类不把 header 值塞进 `clientId`。装了策略则基类保证 `request.clientId === identity.id`（`clientId` 类型保持
   `string`：它是 wire 字段与下游 Map 的 key）。
3. **`ctx.peer` 不在 ctx**：反代后 socket 地址是代理地址、不可信，策略要用就从 `ctx.req` 自己取。
4. **`revoke` 在 P0/P1 没有调用点**：「一个 HTTP 请求结束」不等于「会话结束」。它给通道的会话活性事件预留
   （流关死、通道 reset）。会话活性（resume window 那类「会话还活着吗」）归通道，不进 `RpcIdentityPolicy`。
5. **拒绝的码走枚举**：策略拒绝一律抛 `RpcError('Unauthenticated', RpcStatusCode.UNAUTHENTICATED, 'unauthenticated')`
   （401）。顶级防护按 `err.code` 映射响应状态码，`dispatcher.handleError` 对 401 自动补 `unauthenticated` 状态串，
   客户端拿到的就是 `err.code === 401` / `err.status === 'unauthenticated'`。
6. **发现端点就是内置工具 `rpcApis`，没有旁路**：它由路由表在 `toRpcRequest` 阶段解析成普通寻址（HTTP：
   `GET 前缀根`；Mailbox：无 `toolId` 且 `act: 'list' | 'get'`），于是它与业务调用走同一条流水线（身份判定 →
   `validateRpcRequest` → `dispatcher.dispatch` → 顶级防护回错误封包）。**不要**再给内置端点开第二条身份路径，
   也不要在物理路由里直接回清单。策略里要单独决定它认不认，就比 `ctx.toolId === 'rpcApis'`；不装策略就是今天的逐字节行为。
7. **逐 API 的认证判定在策略里，不在 transport 上**：transport 不为某个 API 开认证开关，只负责把寻址结果与
   `tool` 实例备到 `ctx` 里。要「这个 API 必须认证」，策略侧写谓词（`RpcBearerPolicy.allowAnonymous: (ctx) => ...`），
   读 `ctx.toolId` / `ctx.act` / `ctx.resId` / `ctx.prefix`，或读 `ctx.tool` 上注册时自带的字段
   （继承 `ServerTools` 加的字段、`isApi` / `stream` / `description` 等）。框架不读 `tool` 的任何字段、不解释其含义，
   字段名是部署与业务之间的私有约定。

**逐工具控制：字段是数据，生效靠谓词**（第 7 条的展开，也是最常见的误读）：

在工具注册处写一个 `allowAnonymous: true` **不会**让该工具匿名可进——框架不读 `tool` 的任何字段，那个字段
对框架而言与 `authScope` / `isApi` 无异。要逐工具判定，得在策略侧写谓词读它：

```ts
new RpcBearerPolicy({
  verify,
  // 默认必须认证；工具注册时显式 allowAnonymous: true 才放行匿名
  allowAnonymous: (ctx) => (ctx.tool as any)?.allowAnonymous === true,
})
```

- 字段名与策略选项 `allowAnonymous` 同名容易让人误以为两者有联动（其实没有）。不介意就沿用；想避开歧义就换名，
  比如 `publicAccess: true` 配 `allowAnonymous: (ctx) => (ctx.tool as any)?.publicAccess === true`。
- `ctx.tool` 可能是 `undefined`（工具未寻到 / 不在该前缀注册表里）。谓词要按 `undefined` 明确表态：
  上面那种写法是「寻不到就拒绝」，写成 `(ctx.tool as any)?.requireAuth !== true` 则是「寻不到就放行」。
- 布尔与谓词不共存：`allowAnonymous: false` 一刀切拒绝，不会去看工具字段；要逐工具必须传谓词。
- 这个选项只在 bearer 策略上有；`RpcSessionIdentityPolicy` 没有拒绝路径（凭证不认就是另起新会话），
  要逐工具决定认不认，自己实现 `RpcIdentityPolicy`。

测试：`src/transports/identity-server.test.ts`（「字段本身不生效」+「谓词读字段才生效」）、
`test/identity-e2e.test.ts`（`authScope` 版，端到端）。

登记表（`RpcCredentialRegistry`）四条实现契约：`ensureCredential` 对同一身份幂等复用并滑动 TTL；
`lookupIdentity` 只数**出示**次数、过期/超次数即作废并**删除条目**；满容量先 `prune` 一次、仍满则返回
`undefined`（策略降级为不发续用凭证，连接照常服务）；**框架侧无定时器**，清理只发生在 `lookupIdentity` 命中作废项
与 `ensureCredential` 满容量两处，`prune` 是给部署接定时任务的入口。内置实现按**凭证**为 key、按身份找凭证靠
第二索引（`identityId → credential`），要持久化 / 跨进程共享 / LRU 就自己实现那四个方法从 `registry` 口子注入。

**会话凭证的闭环是四步，默认只做两步**（issue #6）：签发 → 下发 → 客户端带回来 → 认。`assign` 只把凭证放进
返回值，没人写 wire；内置 reader 又只读 `authorization`，所以默认配法下每次连接都是新身份（不报错、不警告）。
HTTP 上跑通它不需要子类化 transport，成对配两行就够：
`identity: new RpcSessionIdentityPolicy({ deliver: 'header:rpc-session' })` 配
`credentialReader: (r) => r.headers['rpc-session']`。

写响应头的是**策略**（用 `ctx.res` 这个逃生口），不是框架：契约 11 不变。`deliver` 默认不配；只认
`'header:<name>'` 这一种 HTTP 形状（写错形状构造时报错），拿不到可写的 res（Mailbox、已 `headersSent`）
就降级为不下发。要 query / SSE welcome 帧这类通道就覆写 `deliverCredential()`。

---

## 10. 信号联动与延迟中止
当任务触发硬超时（Hard Deadline）或收到取消请求时：
1.  `Dispatcher` 会同步调用 `aborter.abort(reason)`。
2.  `RpcDeadlineGuard` 进入 **“延迟中止”** 阶段，先通过信号通知业务代码进行清理。
3.  **宽限期等待**：在 `terminationGraceMs` (默认 500ms) 之后，Guard 正式向外抛出异常。
4.  `RpcActiveTaskHandle` 监听此信号，将内部状态立即切换为 `aborted`。
5.  业务代码接收到 `ctx.signal` 信号，物理停止执行。
6.  `Immediate Cleanup` 机制介入，回收账本资源。

---

## 11. 工具类继承体系

开发时推荐根据业务语义继承不同的基类：

* **ServerTools**：基础类，支持单一 `run` 方法。
* **RpcMethodsServerTool**：引入 **Action (act)** 机制。支持在同一个工具 ID 下定义多个以 `$` 开头的方法，实现类似“服务 (Service)”的逻辑。
* **ResServerTools**：继承自 RpcMethods，专注于**资源 (Resource)** 操作。支持 `get/post/put/delete` 对应 RESTful 语义的自动映射。

---

## 12. 客户端高级连接范式 (Advanced Client Patterns)

为了实现业务逻辑与物理寻址的深度解耦，V2 架构推荐以下连接模式，取代传统的全局 `setTransport` 绑定。

`ClientTools.setTransport(transport)` 已 **@deprecated**（它等价于下面 §12.3 那两行，再顺带调同样已废弃的
`transport.mount(Class)`）。废弃后按地址写，而不是往类上注入 transport：

- 只有地址：`Class.connect(apiUrl)` 或 `Class.apiUrl = apiUrl`，再 `await Class.loadFrom()`；transport 由
  `RpcClientTransportManager.getClient(apiUrl)` 按 scheme 自建（自定义协议先 `RpcClientTransportManager.bindScheme(scheme, Class)`）。
- 已经自己构好了 transport 实例：见 §12.3。

### 12.1 服务连接模式 (Service Connection Pattern)

适用于“一个业务类需要对接多个后端实例”的场景。通过 `connect` 工厂方法，可以为同一个业务定义产生多个物理隔离的连接实例。

```typescript
import { ClientTools } from '@isdk/tool-rpc';

class OrderService extends ClientTools {}

// 1. 声明式绑定：产生两个物理隔离的 Service 类
const httpSrv = OrderService.connect('http://localhost:3000/api');
const mbxSrv = OrderService.connect('mailbox://peer-1/api');

// 2. 独立加载：各服务发现并生成属于自己的 Stub
await httpSrv.loadFrom();
await mbxSrv.loadFrom();

// 3. 强类型调用：底层自动匹配正确的 Transport 协议
const orderA = await httpSrv.createOrder.run({ id: 1 });
const orderB = await mbxSrv.createOrder.run({ id: 2 });
```

- **隔离性**：每个 `connect` 产生的类拥有独立的 `items` 注册表，互不干扰。
- **协议透明**：开发者只需关注业务类（`OrderService`），无需手动处理 Transport 细节。

### 12.2 动态绑定调用 (On-demand Binding)

适用于“同一个工具 Stub 需要动态发往不同集群”的极致灵活性场景。利用 `with` 机制在执行时注入寻址信息。

```typescript
// 1. 获取通用工具存根 (Stub)
const chatTool = ClientTools.get('chat');

// 2. 在执行瞬间决定目标集群 (无需预先创建 Service 实例)
const resUS = await chatTool.with({ apiUrl: 'https://us.api.srv/v1' }).run({ text: 'Hello' });
const resCN = await chatTool.with({ apiUrl: 'https://cn.api.srv/v1' }).run({ text: '你好' });
```

- **极致灵活**：支持在运行时根据负载、地理位置或租户 ID 动态路由 RPC 请求。
- **无状态**：Stub 本身不持有寻址状态，状态仅存在于影子实例的上下文中。

---

### 12.3 预构 transport 实例（带协议专有选项）

mailbox 要 `clientAddress`、自定义协议要带自己的选项时，实例只能自己 new。这时不再 `setTransport`，而是注册到管理器：

```typescript
const clientTransport = new MailboxClientTransport({ mailbox, apiUrl, clientAddress, timeout: 2000 });
await clientTransport.start();

RpcClientTransportManager.instance.register(clientTransport);   // 按 apiUrl 登记
OrderService.apiUrl = clientTransport.apiUrl;                    // 类上只留地址
await OrderService.loadFrom();
```

后面的调用与 §12.1 完全同一条路：`getClient(apiUrl)` 先查已登记实例，查不到才按 scheme 新建。

## 13. 客户端使用范例

```typescript
import { RpcTransportManager, HttpClientToolTransport } from '@isdk/tool-rpc';
import { ClientTools } from './client-tools';

// 1. 注册协议解析器 (全局一次)
RpcTransportManager.bindScheme(['http', 'https'], HttpClientToolTransport);

// 2. [推荐] 使用连接模式：结构清晰，支持多服务并行
const api = ClientTools.connect('http://api.srv/v1');
await api.loadFrom();
const result = await api.myTool.run({ data: 123 });

// 3. [进阶] 动态绑定：适用于路由网关或多区域调度
const stub = ClientTools.get('commonTool');
const resultCN = await stub.with({ apiUrl: 'http://cn.api/v1' }).run();

// 4. [兼容] 直接通过 Transport 手动调用
const transport = RpcTransportManager.instance.getClient('http://api.srv/v1');
const rawRes = await transport.fetch('adder', { a: 1 });
```

---

## 14. V1 到 V2 迁移指南

### 14.1 服务端兼容配置

在 `RpcServerDispatcher` 初始化时，`compat` 选项默认开启以支持旧代码：

* **enableParamBridge**：自动将旧的 `params.id/act` 同步至 context。
* **enableContextInjection**：将原生底座对象注入 `params._req/_res`。

### 14.2 推荐优化

建议新编写的任务显式定义保留策略，并重写 **`func`**（而不是 `run`——`ServerTools.run` 是 V2 标准入口，
负责注入兼容层并调 `super.run`，自己重写它会绕过那套机制）：

```typescript
class MyTool extends ServerTools {
  constructor() {
    super({
      name: 'my-tool',
      isApi: true,
      retention: 'once',  // 获取后自动销毁，最节省内存
    })
  }

  async func(params: ServerFuncParams, context?: ToolRpcContext) {
    const { signal } = context!
    // ... 使用 signal 控制异步逻辑 ...
  }
}
```

---

## 15. 评估与调试

建议在生产环境通过 `RpcTransportManager.instance.validateRpcRequest` 扩展自定义的安全审计，
并用 `onRequestRejected` 记下被拒的尝试（身份 401 / 架构层 403 / 寻址失败，issue #10）。
在调试时，关注响应 Header 中的 `req-id` 确保全链路追踪的闭环：它不只成功响应回显，
流水线错误响应（401/403/400）也回显——客户端对不上自己那次调用的，恰恰就是失败的那批。
