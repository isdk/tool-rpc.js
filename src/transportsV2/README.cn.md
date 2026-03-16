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
// 构造函数: (message, status?, code?, data?)
throw new RpcError('Access Denied', 403, 40301, { reason: 'IP blocked' });
```

---

## 3. 管理中心 (RpcTransportManager)

`RpcTransportManager` 负责传输实例的生命周期、地址映射与架构级策略校验。

### 3.1 核心职责与 API 详述

* **bindScheme (协议绑定)**：
  * **静态绑定**：`bindScheme(['http', 'https'], HttpClient)`。将 Scheme 直接映射到具体的 Transport 类。
  * **动态解析器 (Resolvers)**：`bindScheme((scheme) => ...)`。支持注册函数，当静态注册表未命中时，动态判断并返回对应的 Transport 类。这在插件化系统中非常有用。
* **clearSchemes (注册表清理)**：`clearSchemes(scheme?)`。支持清除全部或特定协议的注册信息，主要用于单元测试环境下的状态隔离。
* **实例缓存与复用**：Manager 会根据 `apiUrl` 的 **Origin (协议+域名+端口)** 路径自动缓存 Transport 实例。这意味着对同一个服务端不同路径的调用将共享同一个物理连接池（如 HTTP Keep-Alive Agent），实现资源的高效复用。
* **架构级策略校验 (validateRpcRequest)**：
  * **SSRF 防御**：通过 `addRestrictedPattern` 注入正则或字符串模式（如 `localhost`, `127.0.0.1`），Manager 会在分发前拦截非法地址请求。
  * **钩子重写**：允许通过继承 Manager 并重写此方法来实现自定义的全局审计逻辑。
* **生命周期管理**：
  * `startAll()`：批量启动所有已注册的服务端 Transport。
  * `stopAll()`：优雅关闭所有实例（包括服务端监听关闭和客户端物理连接池回收）。

### 3.2 实例化与管理范例

```typescript
import { RpcTransportManager } from './transportsV2/manager';
import { HttpServerToolTransport } from './transportsV2/http-server';

const manager = RpcTransportManager.instance;

// 1. 注册服务端传输层
const server = new HttpServerToolTransport({
  apiUrl: 'http://0.0.0.0:3000/api'
});
manager.addServer(server);

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

这是 V2 的重要性能优化：在 `dispatch` 响应返回后，系统立即根据任务的 `retention` 策略评估其是否符合回收条件。若符合（如策略为 `None`），则立即将其从内存移除，无需等待全局的每分钟扫描周期。

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

### 5.2 系统工具 `rpcTask`

内置的任务管控接口，符合 REST 规范：

* **状态查询**：`GET /api/rpcTask/:requestId`。返回 102 (运行中)、200 (已完成并带结果) 或 500/408 (错误/中止)。
* **任务取消**：`POST /api/rpcTask/:requestId?act=$cancel`（物理中止）。

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

---

## 7. 传输层实现细节

### 7.1 HttpServerToolTransport

* **寻址优先级**：Header 显式指令 > URL Path 降级解析 (`/api/tool/resId`模式)。
* **HTTP 102 信号映射**：由于多数现代 fetch 工具（如 `undici`）对 1xx 信息性状态码的处理存在不确定性，V2 在物理层将 `102 Processing` 逻辑映射为 **`202 Accepted`**，并返回包含任务 ID 的 Body 负载，确保客户端能稳定解析。
* **流式背压**：原生支持 `ReadableStream` 管道透传，具备自动检测 `.pipe` 的能力。

### 7.2 信号联动逻辑

当任务触发硬超时（Hard Deadline）或收到取消请求时：

1. `Dispatcher` 会同步调用 `aborter.abort()`。
2. `RpcActiveTaskHandle` 监听此信号，将内部状态立即切换为 `aborted`。
3. 业务层代码接收到 `ctx.signal` 信号，物理停止执行。
4. `Immediate Cleanup` 机制介入，回收账本资源。

---

## 8. 工具类继承体系

开发时推荐根据业务语义继承不同的基类：

* **ServerTools**：基础类，支持单一 `run` 方法。
* **RpcMethodsServerTool**：引入 **Action (act)** 机制。支持在同一个工具 ID 下定义多个以 `$` 开头的方法，实现类似“服务 (Service)”的逻辑。
* **ResServerTools**：继承自 RpcMethods，专注于**资源 (Resource)** 操作。支持 `get/post/put/delete` 对应 RESTful 语义的自动映射。

---

## 9. 客户端使用范例

```typescript
import { RpcTransportManager } from './transportsV2/manager';
import { HttpClientToolTransport } from './transportsV2/http-client';

RpcTransportManager.bindScheme(['http', 'https'], HttpClientToolTransport);
const transport = RpcTransportManager.instance.getClient('http://api.srv/v1');

// 1. 普通调用
const res = await transport.fetch('adder', { a: 1 });

// 2. 指定资源动作 (ResServerTools)
const userInfo = await transport.fetch('user', {}, 'get', 'user-abc');

// 3. 长任务自动轮询
// 若服务端返回 102 (202 Accepted)，fetch 会自动转入后台轮询直至结果返回
const longResult = await transport.fetch('heavy-task', { data: 123 });
```

---

## 10. V1 到 V2 迁移指南

### 10.1 服务端兼容配置

在 `RpcServerDispatcher` 初始化时，`compat` 选项默认开启以支持旧代码：

* **enableParamBridge**：自动将旧的 `params.id/act` 同步至 context。
* **enableContextInjection**：将原生底座对象注入 `params._req/_res`。

### 10.2 推荐优化

建议新编写的任务显式定义保留策略：

```typescript
class MyTool extends ServerTools {
  retention = 'once'; // 获取后自动销毁，最节省内存
  async run(params, context) {
    const { signal } = context;
    // ... 使用 signal 控制异步逻辑 ...
  }
}
```

---

## 11. 评估与调试

建议在生产环境通过 `RpcTransportManager.instance.validateRpcRequest` 扩展自定义的安全审计。在调试时，关注响应 Header 中的 `req-id` 确保全链路追踪的闭环。
