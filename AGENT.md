# @isdk/tool-rpc v2.6 使用手册

## 一、概述

`@isdk/tool-rpc` 是一个 TypeScript 库，用于将本地函数（`ToolFunc`）暴露为远程 RPC 服务。v2.6 重构后，采用 **Trinity 架构**：`RpcTransportManager`（路由管理）、`RpcServerDispatcher`（执行调度）、`RpcActiveTaskTracker`（任务追踪），支持多实例隔离、流式响应、后台任务轮询、物理连接联动等工业级特性。

内置两种传输层：**HTTP**（基于 Node.js http 模块）和 **Mailbox**（基于 `@mboxlabs/mailbox`，适用于跨进程/线程通信）。

## 二、核心概念

### 2.1 三层抽象

| 层次 | 说明 | 典型用途 |
|------|------|----------|
| **ServerTools / ClientTools** | 单个远程函数（如 `ping`） | 简单 RPC |
| **ResServerTools / ResClientTools** | 一组方法组成的 RESTful 资源（CRUD 自动映射） | 资源型服务 |
| **自定义方法** | 在子类中以 `$` 开头的方法（如 `$status`） | 扩展操作，客户端自动去掉 `$` 调用 |

### 2.2 Trinity 组件

| 组件 | 角色 | 关键方法/属性 |
|------|------|---------------|
| `RpcTransportManager` | 协议注册中心、路由归属登记、连接池管理 | `bindScheme()`, `registerServer()`, `startAll()`, `stopAll()`, `validateRpcRequest()`, `onRequestRejected()` |
| `RpcServerDispatcher` | 执行调度、能力协商、影子实例隔离、超时裁决 | `dispatch()`, `handleError()`；每次调用自动登记进 Tracker（`trackTask`），并把自身放进 `ctx.dispatcher`（**`ctx` 上没有 `tracker` 字段**） |
| `RpcActiveTaskTracker` | 任务登记、状态转换、硬死线、结果保留、物理中止联动 | `add()`, `get()`, `remove()`, `stop()`；内部维护 `tasks` Map（每 60s 扫一次，`ttlMs` 默认 5 分钟未访问则中止） |

### 2.3 内置系统工具

- **`rpcTask`**（`RpcTaskResource`）：由 `RpcServerDispatcher` 自动注册到 `systemRegistry`，提供标准任务轮询和取消端点。
  - `GET /api/rpcTask/{resId}` — 查询任务状态（处理中 102 / 完成 200 / 不存在 404 / 出错 500 / 被中止 408）
  - `POST /api/rpcTask/{resId}?act=$cancel` — 取消任务（注意 act 带 `$`；客户端代理会自动去 `$`，所以写 `rpcTask.cancel({ resId })`）
- **`rpcApis`**（`RpcApisResource`，id 常量 `RPC_APIS_TOOL_ID`）：内置发现工具，同样自动注册到 `systemRegistry`。
  它从执行上下文里拿**本次命中前缀**的注册表（`ctx.registry`）列工具清单；不声明自己的 `timeout`，
  所以与业务工具同受 `globalTimeout` 管（`timeout: 0` 是显式「不要死线」，不能拿来当「没配」写）。
  列清单不挑注册表形态（`registryEntries()`）：会 `toJSON()` 的层用它，不会的按静态 `items` / `entries()` / 自有键枚举；
  多层按 `get()` 同一套优先级合并——**`get()` 解析得到的工具必须在清单里**，不能回 `200 {}`。
  清单条目默认不带函数体（`manifestItem()` 在副本上剔 `func`，与 `ServerTools.toJSON()` 同一套规则），
  只有 `allowExportFunc: true` 才导出给客户端本地执行。
  - `GET /api` — 列该前缀的全部工具（`act: 'get'` 带 `resId` 则只回那一个）
  - Mailbox：无 `toolId` 且 `act: 'list' | 'get'` 即发现请求，同样寻址到它

**注意**：不要手动注册 `RpcTaskResource` / `RpcApisResource`，否则导致重复注册错误。

### 2.4 标准化数据模型

#### ToolRpcRequest

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `apiUrl` | string | 是 | 完整逻辑 URL（如 `http://localhost:3000/api/`） |
| `toolId` | string | 是 | 工具注册名 |
| `act` | string | 否 | 子方法（如 `status`, `cancel`） |
| `resId` | string | 否 | 资源 ID |
| `clientId` | string | 否 | 客户端标识（用于 session 识别，自动透传至 header `rpc-client-id`）；装了身份策略后由服务端判定值接管 |
| `identity` | `RpcIdentity` | 否 | 服务端判定的身份（`{ id, attributes?, credential? }`）；**未装策略时不存在** |
| `requestId` | string | 是 | 唯一调用 ID（用于幂等、追踪） |
| `params` | any | 是 | 业务参数 |
| `headers` | object | 否 | 标准 Header（如 `rpc-timeout`, `rpc-act`, `rpc-client-id`，完整列表见 `RPC_HEADERS`） |
| `traceId` | string | 否 | 链路追踪 ID（缺省时 dispatcher 从 `trace-id` header 取，再没有则生成 uuid） |
| `raw` | any | 否 | 底座原生对象逃生口（HTTP 为 `{ _req, _res }`）；dispatcher 拆成 `ctx.req` / `ctx.reply` |

#### ToolRpcResponse

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | number | 状态码（200/102/400/401/404/408/409/500/504；413 由 HTTP 传输层直接回） |
| `data` | any \| ReadableStream | 业务结果或流 |
| `error` | object | 结构化错误（`code`, `status`, `message`, `data`, `stack`） |
| `headers` | object | 元数据（如 `rpc-retry-after`） |
| `raw` | any | 底座原生对象逃生口 |

**常用状态码**：
- 200：成功
- 102：任务进入后台（`keepAliveOnTimeout` 触发）
- 400：能力冲突（请求流但工具不支持）
- 401：身份策略拒绝（凭证缺失或验不过，`RpcStatusCode.UNAUTHENTICATED`）
- 404：工具或任务不存在
- 408：硬死线终止
- 409：requestId 冲突（同一 requestId 重复登记）
- 413：请求体超过 `maxBodySize`（HTTP 传输层，默认 1MB）——由传输层直接回，不在 `RpcStatusCode` 枚举里
- 500：执行错误

### 2.5 任务结果保留策略（`RpcTaskRetention`）

| 值 | 含义 |
|----|------|
| `None` (0) | 完成后立即移除（默认） |
| `Permanent` (-1) | 永久保留 |
| `Once` ('once') | 第一次成功 `get` 后自动清除 |
| `number` (ms) | 保留指定毫秒数 |
| 对象 `RpcTaskRetentionConfig` | `{ mode, onceFallbackMs?, maxRetentionMs? }`：`mode` 同上（枚举或毫秒数）；`onceFallbackMs` 是 `once` 模式的物理清理兜底（默认 1 小时）；`maxRetentionMs` 是任何模式下都必删的硬上限 |

## 三、快速入门（3 分钟）

### 3.1 安装

```bash
npm install @isdk/tool-rpc @isdk/tool-func
# 如果使用 Mailbox 传输层，还需安装：
npm install @mboxlabs/mailbox
```

### 3.2 服务端：注册工具并启动（HTTP 示例）

```typescript
// server.ts
import {
  ServerTools,
  RpcServerDispatcher,
  RpcActiveTaskTracker,
  HttpServerToolTransport,
  RpcTransportManager,
} from '@isdk/tool-rpc';

// 定义简单工具
new ServerTools({
  name: 'greet',
  isApi: true,
  func: ({ name }: { name: string }) => `Hello, ${name}!`,
}).register();

// 创建 Dispatcher（自动注册 rpcTask 到 systemRegistry）
const tracker = new RpcActiveTaskTracker();
const dispatcher = new RpcServerDispatcher({ registry: ServerTools.items, tracker });

// 创建 HTTP 传输
const apiUrl = 'http://localhost:3000/api/';
const transport = new HttpServerToolTransport({ apiUrl, dispatcher });
// 发现端点内置（`rpcApis` 回答 `GET /api`），无需 addDiscoveryHandler
transport.addRpcHandler(apiUrl);

// 注册到 Manager（自动检测路由冲突）
RpcTransportManager.instance.registerServer(transport);
await RpcTransportManager.instance.startAll();
console.log(`Server ready at ${apiUrl}`);
```

### 3.3 客户端：发现并调用（HTTP 示例）

```typescript
// client.ts
import { HttpClientToolTransport, RpcTransportManager, ClientTools } from '@isdk/tool-rpc';

RpcTransportManager.bindScheme('http', HttpClientToolTransport);
await ClientTools.loadFrom(undefined, { apiUrl: 'http://localhost:3000/api/' });

const greet = ClientTools.get('greet');
const result = await greet.run({ name: 'World' });
console.log(result); // "Hello, World!"
```

## 四、进阶用法

### 4.1 流式响应（Streaming）

#### 同时支持流和非流输出（使用 `this.isStream` 判断）

工具可以声明 `params.stream` 参数，让客户端选择输出模式。使用内置的 `this.isStream(params)` 方法来判断是否应该返回流。

```typescript
// 服务端
new ServerTools({
  name: 'flexible-output',
  isApi: true,
  stream: true,                           // 声明支持流式能力
  params: { stream: { type: 'boolean' } }, // 必须在 params 中声明 stream 参数
  func: function (params: any) {
    // 使用内置 isStream 方法判断（注意：必须用 function 声明，不能用箭头函数）
    if (this.isStream(params)) {
      // 流式输出
      return new ReadableStream({
        async start(controller) {
          for (let i = 0; i < 5; i++) {
            controller.enqueue(`块 ${i}\n`);
            await new Promise(r => setTimeout(r, 100));
          }
          controller.close();
        }
      });
    }
    // 非流式输出（一次性返回）
    return '一次性结果';
  },
}).register();

// 客户端：请求流式
const streamResult = await ClientTools.get('flexible-output').run({ stream: true });
for await (const chunk of streamResult) {
  console.log(chunk); // 逐块打印
}

// 客户端：请求非流式
const plainResult = await ClientTools.get('flexible-output').run({ stream: false });
console.log(plainResult); // "一次性结果"
```

**`isStream` 方法逻辑**：
1. 首先检查工具是否具有流式能力（`this.stream` 是否为 `true`）。
2. 如果是，再检查 `params` 定义中是否声明了 `stream` 参数。
3. 如果两者都满足，则返回运行时 `params.stream` 的值；否则返回工具的静态 `stream` 属性。

**关键点**：
- 必须使用 `function` 关键字（而非箭头函数），以保证 `this` 指向工具实例。
- 必须在 `params` 中显式声明 `stream` 参数，否则 `isStream` 会退化为静态 `stream` 属性。
- 客户端无需特殊处理，根据返回值类型自动识别：`ReadableStream` 则迭代，否则直接使用。

#### 流式生命周期行为（基于测试验证）

- Dispatcher 将原始流通过 `TransformStream` 包装，绑定到 Tracker 的 Handle。
- 物理连接关闭（`rawRes.close`）→ 自动调用 `handle.abort('Physical connection closed')` → 流被取消。
- 通过 `handle.abort(reason)` 取消 → 流被取消，原因透传给 `cancel` 回调。
- 流正常结束（`flush`）→ Handle 根据 `retention` 策略自动清理。

### 4.2 后台任务 + 轮询（使用内置 `rpcTask`）

**服务端**：只需声明 `keepAliveOnTimeout`，Dispatcher 会自动把本次调用登记进 Tracker（`trackTask`）。
业务侧**不需要也不应该**自己调 `tracker.add()`（`ctx` 上也没有 `tracker`）。

```typescript
new ServerTools({
  name: 'long-task',
  isApi: true,
  // 软死线 3s：到点服务端回 102，任务继续在后台跑
  timeout: { value: 3000, keepAliveOnTimeout: true },
  retention: 'once',        // 结果第一次被读走后自动清除
  func: async function (this: any, params: { data: number[] }) {
    let total = 0;
    for (const v of params.data) {
      await new Promise(r => setTimeout(r, 1000));
      // 硬死线 / 客户端断开 / rpcTask.$cancel 都会反映到这个 signal
      if (this.ctx.signal.aborted) throw new Error('Task aborted');
      total += v * 2;
    }
    return total;           // 后台完成后结果存入账本，客户端轮询取回
  },
}).register();
```

账本句柄 `RpcActiveTaskHandle` 由 Dispatcher 创建，字段/方法：`status`（`processing`/`completed`/`error`/`aborted`）、
`result`、`error`、`fetchCount`、`aborter`（`aborter.signal.aborted` 判断中止）、`abort(reason)`、`touch()`、
`shouldCleanup(now)`。后台任务另受 dispatcher 的 `maxTaskRuntimeMs`（默认 1 小时）硬死线约束。

**客户端**：通过系统内置的 `rpcTask` 工具轮询。

```typescript
const rpcTask = ClientTools.get('rpcTask') as any;
const longTask = ClientTools.get('long-task') as any;
const init = await longTask.run({ data: [1, 2, 3] });
const taskId = init.requestId;

let finished = false;
while (!finished) {
  await new Promise(r => setTimeout(r, 2000));
  try {
    const result = await rpcTask.get({ resId: taskId });
    console.log('Result:', result);
    finished = true;
  } catch (err: any) {
    if (err.status === 102) {
      // 继续轮询
    } else if (err.status === 404) {
      console.log('Task expired');
      finished = true;
    } else if (err.status === 408) {
      console.log('Task terminated');
      finished = true;
    } else {
      throw err;
    }
  }
}
```

**取消任务**：
```typescript
await rpcTask.cancel({ resId: taskId });
```

### 4.3 使用 Mailbox 传输层

Mailbox 传输层适用于跨进程/线程通信，无需 HTTP 服务器。需要安装 `@mboxlabs/mailbox` 包。

**服务端**：
```typescript
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox';
import { MailboxServerTransport, RpcServerDispatcher, RpcActiveTaskTracker, ServerTools } from '@isdk/tool-rpc';

const mailbox = new Mailbox();
mailbox.registerProvider(new MemoryProvider());

const serverAddr = 'mem://bot@mailbox/api/v1';
const tracker = new RpcActiveTaskTracker();
const dispatcher = new RpcServerDispatcher({ registry: ServerTools.items, tracker });
const transport = new MailboxServerTransport({ mailbox, apiUrl: serverAddr, dispatcher });

// 注册工具（同前）
new ServerTools({ name: 'greet', isApi: true, func: ({ name }: { name: string }) => `Hello, ${name}!` }).register();

// 注册路由（发现端点内置，无需额外声明）
transport.addRpcHandler(serverAddr);

// 启动
RpcTransportManager.instance.registerServer(transport);
await RpcTransportManager.instance.startAll();
```

**客户端**：
```typescript
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox';
import { MailboxClientTransport, RpcTransportManager, ClientTools } from '@isdk/tool-rpc';

const mailbox = new Mailbox();
mailbox.registerProvider(new MemoryProvider());

const transport = new MailboxClientTransport({
  mailbox,
  apiUrl: 'mem://bot@mailbox/api/v1',
  clientAddress: 'mem://client/inbox', // 客户端收件箱地址
});

await transport.start();
// 按 apiUrl 精确登记实例，`getClient()` 直接命中缓存：
RpcClientTransportManager.instance.register(transport);
await ClientTools.loadFrom(undefined, { apiUrl: 'mem://bot@mailbox/api/v1' });

const greet = ClientTools.get('greet');
const result = await greet.run({ name: 'World' });
console.log(result); // "Hello, World!"
```

**注意**：
- 信箱传输**不能走 `bindScheme` 自动构造**：scheme 注册表会执行 `new TransportClass(apiUrl, options)`，
  而 `MailboxClientTransport` 的构造签名是**单个 options 对象**（且 `clientAddress` 必填），因此必须像上面
  那样先 `new` 再 `register(transport)`。
- Mailbox 传输层**不支持流式响应**（`canStream` 为 `false`；基类默认 false，只有 HTTP 传输会置 true），
  如果工具返回流会收到 400 错误。
- `clientAddress` 必须指定，用于服务端回调或状态通知。
- 需要确保服务端和客户端使用同一个 `Mailbox` 实例或相同 Provider（如内存、Redis 等）。

### 4.4 客户端标识 (Client ID)

`@isdk/tool-rpc` 支持在客户端请求中携带 `clientId` 以标识会话来源。该机制实现为**基类统一注入**，各传输层自动继承：

```typescript
// 客户端传入 clientId（任何传输层均可）
const result = await someTool.run(
  { name: 'World' },
  { clientId: 'my-session-001' }
);
```

- **客户端**：`ClientToolTransport.fetch()` 基类自动将 `fetchOptions.clientId` 注入到 header `rpc-client-id`。
- **传输层**：HTTP、Mailbox 等客户端通过展开 `fetchOptions.headers` 自动透传，无需在各自实现中重复处理。
- **服务端**：各协议 `toRpcRequest()` 从 header 解析 `rpc-client-id` 并赋值到 `ToolRpcRequest.clientId` 可选字段。

业务代码可通过 `this.ctx.clientId`（若 `ToolRpcContext` 扩展）或 `this.ctx.headers['rpc-client-id']` 获取。

> **自报值不是身份**。`clientId` 是客户端自己填的；要「连上之后不可冒充」就得装身份策略（见 §4.7）：
> 装了策略后基类保证 `clientId === identity.id`，业务侧读 `this.ctx.identity`。

### 4.5 自定义传输层

实现 `IServerToolTransport` 或 `IClientToolTransport` 接口；服务端建议直接继承 `ServerToolTransport` 基类，以复用路由声明内核（多前缀、归一化、`remount`）。例如集成 Fastify：

```typescript
// 优先继承基类：路由簿记（toPathname / toMatchPrefix / claimRoute / getRoutes / remount）已有默认实现
class FastifyServerTransport extends ServerToolTransport {
  // 必须实现：toRpcRequest(), sendRpcResponse(), _start(), stop(),
  //           addRpcHandler(apiUrl, { registry, remount }), addDiscoveryHandler(apiUrl, handler, { remount })
  //           （后者已 @deprecated：基类仍要求实现它，但新代码不该调它，内置 `rpcApis` 就是清单）
  // 两个 handler 方法内部应调用基类的 claimRoute()：它负责归一化、多前缀簿记与 remount 决策；
  // 返回 null 表示该前缀已声明，只需替换 registry/handler，不应再注册物理路由。
  // 发现端点不必自己写：claimRoute() 会铺内置路由行（`GET 前缀根 → rpcApis`），
  // 要原生注册就读 getRouteTable()，要换掉它就 addRoute(apiUrl, { path: '/', when: { method: 'GET' }, toolId: 'myRoot' })。
  // 仅当需要上报框架原生的重复路由错误时才覆写 onDuplicateRoute()
  // 物理底座标识与 apiUrl 不同时才覆写 getListenAddr()
}
```

### 4.6 多实例与测试隔离

```typescript
// 创建独立 Manager 实例（非全局单例）
const manager = new RpcTransportManager();
const dispatcher = new RpcServerDispatcher({ tracker: new RpcActiveTaskTracker() });
const transport = new HttpServerToolTransport({ apiUrl: 'http://localhost:3001/', dispatcher });
manager.registerServer(transport);
await manager.startAll();
```

### 4.7 身份策略（Identity Policy）

服务端回答「这个请求是谁」。三个文件：`identity.ts`（抽象）、`identity-session.ts`（服务端自签发会话凭证）、
`identity-bearer.ts`（凭证外部签发、服务端只验）。完整规格见根目录 `IDENTITY_POLICY_DESIGN.cn.md`。

```typescript
// A：服务端首次连接自动签发会话凭证（不做认证，但连上后不可冒充、断线可续）。
// 闭环要成对配：`deliver` 下发 + `credentialReader` 取回（内置 reader 只读 authorization）。
new HttpServerToolTransport({
  apiUrl: '/api',
  identity: new RpcSessionIdentityPolicy({ deliver: 'header:rpc-session' }),
  credentialReader: (r) => r.headers['rpc-session'],
});

// B：JWT / api key（做认证；不认就 401）
new HttpServerToolTransport({
  apiUrl: '/api',
  identity: new RpcBearerPolicy({
    verify: async (token) => {
      const p = await jwt.verify(token, JWKS);
      return p ? { id: p.sub, attributes: { scopes: p.scopes } } : undefined;
    },
    allowAnonymous: false,
  }),
});
```

- **业务侧唯一读法**：`ctx.identity?.id` / `ctx.identity?.attributes?.scopes`。不平铺 `ctx.userId` / `ctx.tenantId`。
- **不装策略就是 no-op**：`ctx.identity` 为 `undefined`，`clientId` 仍是客户端自报值（与旧行为逐字节一致）。
- **拒绝要抛** `new RpcError('Unauthenticated', RpcStatusCode.UNAUTHENTICATED, 'unauthenticated')`（401）；
  `match` 返回 `undefined` 只是「另起新会话」。
- **被拒的尝试走 `manager.onRequestRejected(request, err)` 审计**，不是 `validateRpcRequest`：后者跑在身份判定
  之后，401 根本走不到它。流水线错误响应也回显 `req-id`（与正常路径一致）。
- **会话凭证的闭环是四步，默认只做两步**：签发与认。下发要 `deliver: 'header:<name>'`（策略自己经
  `ctx.res` 写头，框架不写），取回要配 `credentialReader`。两者都不配时每次连接都是新身份，
  **不报错也不警告**——别把「续用不上」当成 bug，它是防冒充不是登录流程。
- **凭证取法可换，且 reader 权威**：`credentialReader` 从原生 req 取字符串，内置默认只读 `authorization`（去 Bearer 前缀）；
  私有 header 自己写 reader。它返回 `undefined` 就是「这条请求没带我要的凭证」：`RpcBearerPolicy` 不会回头
  再读 `authorization`（否则部署明确不信的来路仍会被用）。`ctx.credentialRead` 就是用来区分「reader 拒读」与
  「没人读过」的；要「只认客户端标准 header」那种拓扑就显式写 `fallback: 'authorization'`。
- **逐 API 的认证判定在策略里，不在 transport 上**：`allowAnonymous` 可以是谓词（`(ctx) => boolean`）。
  `ctx` 带寻址结果与备料：`toolId` / `act` / `resId`、`prefix` / `apiUrl`、`tool`（注册表里那个实例，**只读**，
  按 dispatcher 的解析顺序取，取不到就 `undefined`）。没有 `builtin` 开关——内置端点也是普通工具，
  要区分就比 `ctx.toolId === 'rpcApis'`。工具注册级元数据直接读 `ctx.tool` 上自带的字段（继承 `ServerTools` 加字段）。
  **不要**在路由声明或工具注册上加 `requireIdentity` 这类开关字段——那等于框架开始解释业务元数据，且与策略谓词重复。
- **发现端点就是内置工具 `rpcApis`**：它与业务调用走同一条流水线（`toRpcRequest` 经路由表解析出 toolId →
  身份判定 → `validateRpcRequest` → `dispatcher.dispatch`），**没有第二条身份路径**，也没有“物理路由直接回”的分支。
  默认公开，要不要认由策略谓词定（`ctx.toolId === 'rpcApis'`）。客户端 `ClientTools.loadFrom()` 会把类级
  `fetchOptions`（凭证就在那）合进发现调用。

## 五、关键注意事项

### 5.1 路径规范化
逻辑路由（`getRoutes()`）以 **canonical 形式**声明：以 `/` 开头、**不带**尾随斜杠（根路由为 `/`），由 `ServerToolTransport.toPathname()` 归一化。前缀匹配与物理路由表的 key 由 `toMatchPrefix()` 补尾随斜杠后派生——**匹配阶段**仍遵循 Trailing Slash Normalization，`/api` 不会误匹配 `/apix`。声明路由请用 `claimRoute()`，不要手写字符串拼接。

**`getRoutes()` 报 `'/'` 是接管声明，不是「那里有发现端点」的保证**：内置路由行（`builtinRouteEntries()`）只由 `claimRoute()` / `addRoute()` 插入，所以从未声明前缀的 transport 路由表为空，`GET /` 回 400（表为空时错误会点名缺的那一步）。内置**工具** `rpcApis` 本身始终在系统注册表里，显式寻址（`rpc-fn: rpcApis`）总能命中。适配器按 `getRouteTable()` 原生注册前，先确认前缀已声明。

**归属登记与路由必须同步**：`claimRoute()` 只改路由表，Manager 的归属表由 `registerServer()` / `unregisterServer()` 维护。框架适配器（Fastify/Electron/Express）应在自己的子类里成对调用 `registerRoutes()` / `unregisterRoutes()`（它们同时做 claim 与归属登记），而不是只调 `claimRoute()`——否则 `close()` 后归属表残留条目，下次 `listen()` 会误报 `Routing Conflict`。

### 5.2 影子实例隔离
Dispatcher 在执行时为每个请求创建 `Object.create(tool)` 的影子实例，`this.ctx` 仅属于本次调用。**严禁在工具函数中修改原始对象的属性**。

### 5.3 物理连接关闭自动清理
传输层（如 `HttpServerToolTransport`）监听 `rawRes.close` 事件，自动调用 `handle.abort('Physical connection closed')`。这适用于流式响应和后台任务，无需手动处理。

### 5.4 requestId 来源与唯一性
`requestId` 由**传输层**决定，不是 Dispatcher 生成的：HTTP 传输取 header `req-id`，缺失时回退到 `uuidv4()`；
Mailbox 在严格模式下**必须**带 `req-id` header（否则 400），非严格模式回退到消息 id。业务侧只读
`this.ctx.requestId`，不要自己生成。同一 `requestId` 重复登记会抛 409（`RpcStatusCode.CONFLICT`）。

### 5.5 能力协商
- 工具声明 `stream: true` 才支持流式输出。
- 客户端请求流但工具不支持 → 返回 400。
- 传输层不支持流（如 Mailbox）但工具返回流 → 返回 400。

### 5.6 不要手动注册 `RpcTaskResource` / `RpcApisResource`
它们由 `RpcServerDispatcher` 在初始化时自动注册到 `systemRegistry`。手动注册会导致重复注册错误。
要换掉发现端点，不必删内置项：在自己注册表里注册同名 `rpcApis` 就覆盖它（解析顺序：业务表优先于系统表），
或者用 `addRoute()` 声明同一路由行把 `GET 前缀根` 指向自己的工具。

### 5.7 超时与死线
- **软死线**：触发 102 Processing，任务转入后台（需设置 `keepAliveOnTimeout: true`）。
- **硬死线**：触发 408 Terminated，强制中止任务。
- 通过 `timeout` 配置对象设置：`{ value: 8000, keepAliveOnTimeout: true }`。

### 5.8 结果保留策略
- `retention: 'once'` 时，第一次成功 `get` 后任务被逻辑删除（`fetchCount++` 触发清理）。
- 如需多次查询，使用 `Permanent` 或指定保留时长。

### 5.9 错误处理
推荐抛出 `RpcError`（`new RpcError(message, code, status?, data?)`），Dispatcher 会自动映射为标准化错误响应。

### 5.10 `isStream` 的正确使用
- 必须使用 `function` 声明（非箭头函数），以保证 `this` 指向工具实例。
- 必须在 `params` 定义中显式声明 `stream` 参数，否则 `isStream` 会退化为静态 `stream` 属性。
- 如果工具始终返回流，可以省略 `params.stream` 声明，此时 `isStream` 返回 `this.stream`（即 `true`）。

## 六、完整示例代码

完整可运行的服务端 + 客户端示例见本文档的“快速入门”和“进阶用法”章节。所有代码可直接复制使用。

## 七、迁移指南（从旧版 v1.x 到 v2.6）

| 旧版 | 新版 |
|------|------|
| `apiRoot` | `apiUrl`（完整 URL） |
| `mount(tools)` | `registerServer()` + `addRpcHandler()` |
| `ClientTools.setTransport(transport)` | `ClientTools.connect(apiUrl)` + `loadFrom()`（地址在类上，transport 按 scheme 自建）；已经自己构好一个 transport（mailbox 要 `clientAddress`、自定义协议要带选项）就 `RpcClientTransportManager.instance.register(transport)` + `Class.apiUrl = transport.apiUrl` |
| `addDiscoveryHandler(apiUrl, handler)` | 什么都不用加：发现清单由内置工具 `rpcApis` 回答（`addRpcHandler(prefix)` 就够）。要自定义清单内容才保留它，或自己注册一个工具再 `addRoute(apiUrl, { path: '/', when: { method: 'GET' }, toolId: 'myListing' })` |
| 全局单例依赖 | 支持 `new RpcTransportManager()` 独立实例 |
| 无任务追踪 | 内置 `RpcActiveTaskTracker` + `RpcTaskResource` |
| 手动管理流生命周期 | 自动包装 TransformStream，物理连接联动 |
| 自定义轮询端点 | 使用系统内置 `rpcTask` |

**自动桥接**：旧版 `apiRoot` 会被包装为 `http://localhost/apiRoot`，旧版 `setTransport` 会注册到全局单例
（它等价于 `manager.register(transport)` + 把 `transport.apiUrl` 写进类的 `apiUrl`，顺带调同样已废弃的 `transport.mount()`）。
两个旧入口都仍可用，但已标 `@deprecated`：新代码按 `apiUrl` 寻址，不要把一个 transport 全局绑到一个工具类上
（多个后端会互相覆盖）。

## 八、浏览器端使用

### 8.1 Browser Entry (`@isdk/tool-rpc/browser`)

`@isdk/tool-rpc` 提供了独立的浏览器入口 `@isdk/tool-rpc/browser`，不依赖任何 Node.js 内置模块（`http`, `stream`, `crypto` 等）。该入口包含客户端模块、抽象服务端类以及完整的传输基础设施，仅排除 Node.js 特有的服务端传输层。

### 8.2 导出内容

浏览器入口导出的模块包括：
- **客户端工具**: `ClientTools`, `RpcMethodsClientTool`, `ResClientTools`
- **客户端传输**: `ClientToolTransport`, `HttpClientToolTransport`, `IClientToolTransport`
- **抽象服务端类**: `ServerTools`, `RpcMethodsServerTool`, `ResServerTools`
- **传输基础设施**:
  - `RpcTransportManager` — 完整版传输管理器（含服务端生命周期管理）
  - `RpcClientTransportManager` — 轻量版客户端管理器
  - `RpcServerDispatcher` — 执行调度器（影子实例、超时裁决）
  - `ServerToolTransport` — 服务端传输基类
  - `RpcActiveTaskTracker` / `RpcActiveTaskHandle` — 任务追踪
  - `RpcDeadlineGuard` — 死线守卫
  - `RpcTaskResource` — 系统内置的 rpcTask 资源
  - `RpcApisResource` / `RPC_APIS_TOOL_ID` — 系统内置的发现工具（列工具清单）
- **共享类型和常量**: `RPC_HEADERS`, `RPC_DEFAULTS`, `RpcStatusCode`, `RpcError`, `ToolTransport`, `ToolRpcRequest` 等

**不包含**的 Node.js 特有模块：`HttpServerToolTransport`、`MailboxServerTransport`、`MailboxClientTransport`。

### 8.3 管理器架构（Manager Split）

原有的 `RpcTransportManager` 拆分为两个类，但浏览器入口现在同时导出两者：

| 类 | 作用域 | 说明 |
|-----|--------|------|
| `RpcClientTransportManager` | 浏览器 + Node.js | 轻量版，仅含 `register()`, `getClient()`, `bindScheme()`, `clearSchemes()` 等客户端方法 |
| `RpcTransportManager` | 浏览器 + Node.js | 继承自 `RpcClientTransportManager`，额外增加 `registerServer()` / `unregisterServer()`, `startAll()`, `stopAll()`, `validateRpcRequest()`, `onRequestRejected()`（被流水线拒掉的请求的审计钩子）等服务端方法（旧名 `addServer()` 已废弃） |

```
src/transports/
├── client-manager.ts    RpcClientTransportManager (浏览器 + Node.js 客户端)
├── server-manager.ts    RpcTransportManager extends RpcClientTransportManager (Node.js 完整版)
├── base.ts              ToolTransport基类，使用 RpcClientTransportManager
├── server.ts            ServerToolTransport，构造函数中覆盖 manager 为 RpcTransportManager.instance
├── browser.ts           browser entry barrel (浏览器 + Node.js)
└── index.ts             导出 server-manager（Node.js 入口）
```

**Node.js**: `import { RpcTransportManager } from '@isdk/tool-rpc'`（完整功能）
**浏览器**: `import { RpcTransportManager } from '@isdk/tool-rpc/browser'`（完整功能）

### 8.4 使用示例

```typescript
// 浏览器端：完整的内存 RPC 循环
import {
  ClientTools, ServerTools, RpcServerDispatcher,
  HttpClientToolTransport, RpcTransportManager,
} from '@isdk/tool-rpc/browser'

// 注册 HTTP 协议
RpcTransportManager.bindScheme('http', HttpClientToolTransport)

// 注册服务端工具
ServerTools.register({
  name: 'greet',
  func: ({ name }) => `Hello, ${name}!`,
})

// 创建调度器（可选，用于直接 dispatch）
const dispatcher = new RpcServerDispatcher({ registry: ServerTools.items })
await dispatcher.dispatch({
  apiUrl: 'memory://local',
  toolId: 'greet',
  requestId: 'req-001',
  params: { name: 'World' },
  headers: {},
})
// → { status: 200, data: 'Hello, World!' }

// 客户端远程调用
await ClientTools.loadFrom(undefined, { apiUrl: 'http://localhost:3000/api/' })
const greet = ClientTools.get('greet')
const result = await greet.run({ name: 'World' })
```

### 8.5 构建产物验证

每次构建后，`test/browser-entry.test.ts` 会自动验证：
- 所有客户端模块正确导出
- 所有抽象服务端模块和传输基础设施正确导出
- Node.js 特有模块（`HttpServerToolTransport`, `MailboxServerTransport` 等）不泄漏到 browser 入口
- 构建产物 (`dist/browser.js`/`.mjs`) 不含 Node 内置模块引用
- 类型声明 (`dist/browser.d.ts`) 包含客户端与服务端抽象类型，但不含 Node.js 特有服务器传输类型

此外，`test/http-client-browser.test.ts` 提供了 52 项纯浏览器模拟环境的测试，覆盖 URL 构建、请求方法、RPC 头注入、102 轮询、超时、流空闲超时、API 发现、超时协商等完整能力。

## 九、附录：接口速查

### 服务端关键接口

```typescript
interface IServerToolTransport {
  getListenAddr(): string | string[]; // 物理地址（如 ':3000'）
  getRoutes(): string[];            // 逻辑路由（canonical 前缀，无尾随斜杠）
  start(): Promise<void>;
  stop(): Promise<void>;
  // 以下两个在 ServerToolTransport 基类上，内部通过 claimRoute() 登记前缀
  addRpcHandler(apiUrl: string, options?: RouteClaimOptions): void;             // { registry?, remount? }
  // 兼容外壳（已 @deprecated，首次调用打一次迁移提示）：它只把自定义清单挂成该前缀的 `rpcApis` 实现；不写也有内置发现端点
  addDiscoveryHandler(apiUrl: string, handler: Function, options?: RouteClaimOptions): void;
  // 路由表：声明/读取前缀内的路径 → 工具寻址（内置发现行就在里面，第三方同 key 声明可换掉）
  addRoute(apiUrl: string, entry: RouteEntry): void;   // { path, when?: { method?, act? }, toolId, act? }
  getRouteTable(): Array<RouteEntry & { prefix: string }>;
}
```

下面这一对不在 `IServerToolTransport` 上，而是 `ServerToolTransport` 基类的 **`protected`** 成员，只能从自己的 transport 子类里调（框架适配器正是子类）：

```typescript
// ServerToolTransport（protected）
registerRoutes(): void;      // 同步「物理路由表 + Manager 归属表」
unregisterRoutes(): void;    // 反向；内部先 unregister 再 register，因此可重复调用
protected processIncomingCall(rawReq, rawRes, registry?): Promise<void>;
// 身份管道（装了 identity 策略才生效；不装就是 no-op）：
protected resolveRequestIdentity(rpcReq, rawReq?, rawRes?): Promise<void>;
protected resolveRouteTool(rpcReq): any;                   // 策略看到的 `ctx.tool`（只读备料）
protected requestRegistry(rpcReq): any;                    // 本次请求的注册表视图（分层解析）
protected sendPipelineError(err, rawRes): Promise<void>;   // 顶级防护的出口，取码规则全仓同一套
```

Manager 侧对应的一对是 `registerServer()` / `unregisterServer()`（旧名 `addServer()` 已废弃）：前者把 transport 接入当前 Manager 并登记归属，后者只注销归属与 transport 映射，**不**停底层 server。

### 客户端关键接口

```typescript
interface IClientToolTransport {
  call(request: ToolRpcRequest): Promise<ToolRpcResponse>;
  // 可选：自动处理 102 轮询
}
```

### 任务 Handle 关键方法

```typescript
interface RpcActiveTaskHandle {
  state: 'pending' | 'processing' | 'completed' | 'error' | 'aborted';
  result: any;
  error?: Error;
  signal: AbortSignal;
  resolve(value: any): void;
  reject(error: Error): void;
  abort(reason?: string): void;
  setOutputStream(stream: ReadableStream): void;
}
```
