# TODO - tool-rpc

> 2026-10-11 逐项对着代码核过一遍：已实现的标 `[x]` 并附证据行号，未实现的标 `[ ]` 并写明当前实况。
> 2026-10-12 新增「身份策略」一节（设计定稿见 `IDENTITY_POLICY_DESIGN.cn.md`，那一节的行号也是当日实测）。
> 2026-10-12（第二轮）：新增「流式（streaming）」一节，`RpcStreamReassembler` 提案拆到 `RFC_STREAM_REASSEMBLY.cn.md`；
> 本文件里的 `file.ts:NN` 引用逐个回核，修了 `client-tools.ts` 三处漂移（`98-110`→`118-131`、`118`→`140`、`109`/`175`→`127`/`190-193`）；
> 跳仓引用（tool-event / tool-electron / tool-rpc-fastify）已标清所在仓。
> 注：各 `[x]` 条目末尾的「检查」是**当时那一轮**的实测快照，不是当前值。最近一次全量复核（2026-10-12）：
> `vitest run` **51 文件 / 670 通过**、`tsc -p tsconfig.json` exit 0。

## ClientTools 架构优化

- [ ] **优化 `ClientTools.connect` 的元数据复用**（未实现）
  - **现状**: `connect` 创建子类后仍重置 `items = {}`（`src/client-tools.ts:63-68`，注释写明是「Scope isolation for discovered stubs」），每个连接实例都要重新 `loadFrom` 填充工具桩。没有 `with({apiUrl})`，也没有靠原型链共享 `items`。
  - **目标**: 所有连接实例（BoundService）共享同一套工具定义（Metadata），仅在请求终点（`apiUrl`）和执行配置上保持独立。
  - **思路**:
    - 考虑使用类似 `with({apiUrl})` 的模式，利用原型链继承 `items`。
    - 确保工具实例在执行 `fetch` 时能够正确获取到所属子类/实例的 `apiUrl`。
    - 避免每个实例都执行一次 `loadFrom` 的远程获取过程。
  - **注意**: 共享 `items` 与现有「Scope isolation」是同一处代码的两个诉求，改动要说明隔离性怎么保（同名工具在不同 apiUrl 上的桩不能互相污染）。

- [x] **增强 `loadFrom` 的灵活性**（已实现）
  - `loadFrom(items?, options?)` 在传入 `items` 时**跳过网络 fetch**，直接走 `loadFromSync(items, apiUrl)`（`src/client-tools.ts:118-131`，`loadFromSync` 定义于 `:140`）；只有 `items` 缺省时才 `transport.loadApis()`。
  - 「从已有的元数据（如父类的 `items`）同步定义」这条诉求已经满足，无需再实现。

## 传输层默认值

- [ ] **`RPC_DEFAULTS.GLOBAL_TIMEOUT_MS` 定义了但无人消费**
  - `src/transports/models.ts:49` 声明默认全局硬超时 30000，**生产代码零消费**：全仓除定义处外，唯一命中是 `src/transports/models.test.ts:20` 断言这个常量本身的值。
  - 实况：默认值散在各处各写各的——`mailbox-client.ts:51` 的 `options.timeout || 30000`、`mailbox-client.ts:99` 的 `timeoutValue()` 兜底 30000。
  - **目标**: 默认超时从 `RPC_DEFAULTS` 单点取，避免默认值漂移；顺带确认 HTTP 侧的默认超时是否同一来源。

## 流式（streaming）

- [ ] **分片流的顺序重组与 RPC 层背压（`RpcStreamReassembler`）**（未实现，未排期；提案见 `RFC_STREAM_REASSEMBLY.cn.md`）
  - **实况**：流以单条物理通道直传——HTTP 侧 `Readable.fromWeb` 桥接（`src/transports/http-server.ts:648`），无分片、无序号、无重传。全仓 grep `RpcStreamReassembler` / `sequenceNumber` 除 RFC 本身外零命中，**不要当现状引用**。
  - 能力判定是**后置**的：`processIncomingCall` 在 dispatch 之后查 `!this.canStream`，把流改写成 `400 bad_request`（`src/transports/server.ts:263-272`）；基类默认 `false`（`:175`），HTTP 置 `true`（`src/transports/http-server.ts:133`）。能力由服务端单方面声明，协议两侧无握手。
  - 生命周期收尾只有一个钩子：`createCallbacksTransformer({ onClose })`，`status: 'final' | 'error' | 'cancel'`（`src/transports/dispatcher.ts:285-293`）；`TransformStream` 本身没有 cancel 钩子，客户端侧靠自建流的 `underlyingSource.cancel`（`src/transports/http-client.ts:11-18`）。
  - **目标**：分片型协议（Mailbox 这类消息通道）上搬运 `ReadableStream` 时，按 `seq` 重排 + 去重 + 有界重排窗口，缺口超时即终止流；RPC 层要有流量反馈，而不是只靠 Web/Node 流自身队列。
  - **先决**：RFC §4 六个开放问题先定（序号归属、能力协商、背压回传通道、内存上界与 `retention` 计时起点、错误分片传播、与 102 轮询的关系），再动 `ToolRpcResponse` 的流契约。

## 测试

- [ ] **Web Worker Test**（未实现）
  - `package.json` 里没有 `@vitest/web-worker`，也没有 worker 集成测试（现有 `worker` 命中都是 vitest 的 worker 进程注释与 `worker_threads` 导出名单，见 `test/browser-entry.test.ts:39`）。
  - 目标：安装 `@vitest/web-worker`，创建真正的集成测试（PostMessage + 完整 RPC 循环）。

- [x] **排查 RpcError 问题**（症状已解决）
  - `RpcError` 已定义并导出（`src/transports/models.ts:182`），公开面钉在导出名单里（`test/browser-entry.test.ts:55`，Node/browser 两个入口都断言 `toBeDefined()`，`:173`），并有传播测试（`test/browser-rpc-integration.test.ts:700+`、`src/transports/models.test.ts:36,47`）。原报的「not defined」不可能再来自导出层。
  - **残留（未实现）**: 现有传播测试抛的是 plain `Error` + `.code`（`browser-rpc-integration.test.ts:709-713`），缺一条「工具 `func: () => { throw new RpcError(...) }`」的箭头函数回归用例——正是原报的写法。

- [ ] **Service Worker 测试**（未实现）
  - 无任何 Service Worker 相关测试。目标：添加 Service Worker RPC 测试。

## 身份策略（identity）

设计定稿在 `IDENTITY_POLICY_DESIGN.cn.md`（v2.1）。分期见它的 §11，逐项清单见 §14。下面只记「代码里现在有什么/缺什么」。

- [x] **三个文件与 11 个公开符号**（已实现，P0 + P1a + P1b，2026-10-12）
  - 三个文件已落：`src/transports/identity.ts`（153 行，抽象 + 内置 reader `readBearerCredential`，包内）、`identity-session.ts`（205 行）、`identity-bearer.ts`（121 行）。
  - 名单先行：`test/browser-entry.test.ts:122` `EXPECTED_IDENTITY_TYPES`（11 个，钉在 dist/browser.d.ts 的导出块，断言在 :765）、`:135` `EXPECTED_IDENTITY_VALUES`（三个类，运行时 import 两个入口逐个 `typeof`，:255-257）。八个类型进不了运行时 import，只能由 dist 断言钉。
  - 导出：`src/transports/index.ts:20-31` 与 `src/transports/browser.ts` 同名单显式导出；`readBearerCredential` 不在公开面（实测不在 `dist/*.d.ts`）。
  - 载体（P1a）：`ToolRpcRequest.identity`（`src/transports/models.ts:121`）、`ToolRpcContext.identity`（`:168`）、`dispatcher.prepareContext` 透传（`src/transports/dispatcher.ts:197`）。
  - 调用点（P1b）：`ServerToolTransport.resolveRequestIdentity`（`src/transports/server.ts:292`）插在 `toRpcRequest` 与 `validateRpcRequest` 之间（调用在 `:254`）；构造选项 `{ identity, credentialReader }`；`clientId` 由判定值接管（契约 3）。HTTP 与 Mailbox 共用默认 reader（两者原生请求都带 `headers`）。
  - 单测：`src/transports/identity.test.ts`（§3 十一条 + §4 四条 + §7/§8 例子）、`src/transports/identity-server.test.ts`（未装策略逐字节透传、401 响应形状、Mailbox reader、ctx 备料）。
  - **检查**（2026-10-12 实测）：两份 tsc exit 0、`eslint .` exit 0、`npx tsup --dts --dts-resolve` exit 0、`vitest run` **46 文件 / 573 通过**（基线 44/539）。

- [x] **内置登记表的第二索引与内存有界单测**（已实现）
  - `RpcInProcessCredentialRegistry` 两个 Map：`entries`（凭证为 key）+ `identityIndex`（`identityId → credential`，`src/transports/identity-session.ts:65`），`ensureCredential` 不线性扫。
  - 单测钉住了：一万次闲置身份后 `entries.size` 始终 ≤ `maxEntries`；无定时器（过期项不主动清，`lookupIdentity` 命中作废项才删、`ensureCredential` 满容量才 `prune`）；作废即删条目；幂等复用 + 滑 TTL、重新签发不重置计数。见 `src/transports/identity.test.ts` 的 `credential registry (§4)`。

- [x] **401 进枚举 + bearer 单测 + 端到端**（已实现，2026-10-12 复盘，见设计文档 §15）
  - `RpcStatusCode.UNAUTHENTICATED = 401`（`src/transports/models.ts:92`）；`identity-bearer.ts:114` 的 `reject` 改用枚举；`dispatcher.handleError` 对 401 自动补 `unauthenticated` 状态串（`src/transports/dispatcher.ts:380`，与原有 400/404/409 同列）。枚举不是闭集：策略要 403 直接写 403。
  - `src/transports/identity-bearer.test.ts`（15 条）：`allowAnonymous` 两态、「verify 不认」与「无凭证」同形状、verify 可 async、verify 抛错不被吞、reader 优先级、`assign` 不带 credential、三个 `protected` 覆写点、策略无状态可复用。
  - `test/identity-e2e.test.ts`（16 条）：真 socket + 真 Mailbox。401 到客户端是 `RPC Error [401]` + `code: 401` + `status: 'unauthenticated'` 且业务工具零调用；合法凭证下 `ctx.identity` 就是 `verify` 产物；`ClientTools.loadFrom()` + `run()` 全栈走通；会话凭证经响应头下发后**下发与取回必须成对配**（只配 `res.setHeader` 不配 `credentialReader` → 每次新身份）；Mailbox 共用默认 reader。
  - 新基线：`vitest run` **48 文件 / 605 通过**；两份 tsc、`eslint .`、`tsup --dts --dts-resolve` 均 exit 0（`UNAUTHENTICATED = 401` 已进 dist d.ts）。

- [x] **发现端点收进流水线：内置工具 `rpcApis` + 路由表**（已实现，2026-10-12 第三轮，见设计文档 §17）
  - 第二轮的「多一步 `resolveBuiltinIdentity`」已推翻：内置端点不该有特权通道。现在它是 `systemRegistry` 里的普通工具
    `rpcApis`（`src/transports/rpc-apis.ts`，`timeout: 0`），与 `rpcTask` 同处自动装载（`src/transports/dispatcher.ts:58-59`）。
  - 路由表：`addRoute()` / `getRouteTable()` / `matchRouteEntry()`（`src/transports/server.ts:490` / `:515` / `:532`）。
    每个前缀自带三行内置声明（`builtinRouteEntries()`，`:456`）：`GET 前缀根`、`act: 'list'`、`act: 'get'`；
    第三方用同一个 `addRoute()` 同路径同条件就能换掉它。
  - 注册表分层真正参与 dispatch：`requestRegistry(rpcReq)`（`src/transports/server.ts:371`）按「前缀 claim →
    transport → dispatcher → 系统保留」叠视图。修了半成品：之前 `mount(RegB, '/v2')` 会把 `/api` 也改指向 RegB。
  - 删了 `resolveBuiltinIdentity` 与 `ctx.builtin`（第二轮新加、未发布）；`sendPipelineError`（`src/transports/server.ts:330`）
    保留，但只作为顶级防护的出口。`addDiscoveryHandler` 降级为兼容外壳：它只把 handler 挂成该前缀的 `rpcApis` 实现。
  - 客户端：`loadApis()` 发 `toolId: 'rpcApis'`，旧服务端 404 时回退空 `toolId`（`src/transports/client.ts:53-64`）。
    `ClientTools.loadFrom()` 仍把类级 `fetchOptions` 合进发现调用（`src/client-tools.ts:127`）。
  - 测试：`src/transports/route-table.test.ts`（25 条：路由表归一/覆盖/最长前缀/内置行/注册表分层）、
    `test/discovery-e2e.test.ts`（15 条 e2e：HTTP 8 条 + Mailbox 7 条，发现走完整流水线：身份、校验、超时、
    多前缀各列各自清单、旧客户端回退、`addDiscoveryHandler` 兼容外壳）、
    `test/identity-e2e.test.ts`（谓词比 `ctx.toolId === 'rpcApis'`）。
  - Mailbox 侧补了一行：`addRpcHandler(apiUrl, { registry })` 以前丢掉 `registry`（基类的 `RouteClaimOptions` 有它），
    现在转给 `claimRoute`（`src/transports/mailbox-server.ts:73-77`），所以 mailbox 也能按前缀挂注册表。
  - **检查**（2026-10-12 实测）：`vitest run` **50 文件 / 652 通过**（上一基线 48/608）；两份 tsc、`eslint .`、`tsup` exit 0；
    `typedoc --plugin typedoc-plugin-markdown` 0 errors。

- [x] **路由/发现这层的收尾：property 测试 + `addDiscoveryHandler` 标 deprecated**（已实现，2026-10-12 第四轮）
  - property-based 测试：`src/transports/route-path-properties.test.ts`（12 条，P1-P12，随机路径 / 大小写 / percent-encoding /
    尾斜杠 / 重复斜杠 / dot 段 / unicode）：归一化幂等且形态恒定、`''` 与 `'/'` 同义、尾斜杠两态、非法转义落 400 不落 500、
    dot 段越出根（request 报 400、filesystem 在根上夹住）、`%2F` 永不切段、大小写不折叠（`/Api` 与 `/api` 两条）、
    声明侧与请求侧按 http-server 取段方式重放必命中、写法变体归一条、最长前缀胜出且 `/api` 不误配 `/apix`、
    随机工具名全量往返、无 `toJSON` 的 Map 形注册表不吞条目。
  - `addDiscoveryHandler` 标 `@deprecated`（基类抽象声明 + HTTP / Mailbox 两个实现），运行时经 `warnDiscoveryDeprecated()`
    打一次迁移提示（`ServerToolTransport` 上的进程级 static flag，不刷屏）：`src/transports/server.ts:660-668`，
    调用点 `http-server.ts:213` / `mailbox-server.ts:66`。测试钉三件事：首次打一次、后续不刷、只用 `addRpcHandler`
    的用户收不到（`src/transports/route-table.test.ts` 末段，靠 `vi.resetModules()` 重置 flag）。
    `route-claims.test.ts` 那条 `toHaveBeenCalledTimes(1)` 改成只数「替换」告警（按 `is already claimed` 过滤），
    否则它把两件不相干的事绑在同一个 `console.warn` 上。
  - 修了自己埋的坑：`test/discovery-e2e.test.ts` 以前占 3311/3312，与 `src/transports/routing-audit.test.ts` 硬绑的 3311 撞车
    （那个用例故意要 EADDRINUSE）。已挪到 3411/3412/3421/3431/3441。
  - 文档同步：deprecated 已写进 README（两份）、`AGENT.md`、`src/transports/README.cn.md`、`IDENTITY_POLICY_DESIGN.cn.md` §17、
    `mailbox-tool-rpc-integration.md`；`ARCHITECTURE.cn.md` 补 §1.4「两级寻址」，`TRANSPORT_REFACTOR_DESIGN.cn.md` §3 补路由表与
    deprecated 标记。`CHANGELOG.md` 是 `commit-and-tag-version` 生成的，本轮未发布所以无条目（不是漏写）。
  - 行号引用回核：12 份手写文档里的 `file.ts:NN` 引用逐个对过代码，改了 20 余处漂移（`models.ts` 49/92/121/168/182、
    `server.ts` 160/210/248/250/254/256/261/275-277/292/355/426/532、`dispatcher.ts` 181/197/380、
    `identity-bearer.ts` 32/70/76、`mailbox-server.ts` 73-77/123-128/198-199、`mailbox-client.ts` 39-41、
    `browser-entry.test.ts` 122/135/173/255-257/765）。跨包引用（tool-event / tool-electron / fastify / ai-tool 的 src）不在本仓，未核。
  - **检查**（2026-10-12 实测）：`vitest run` **51 文件 / 667 通过**（上一基线 50/652）；`tsc -p tsconfig.json`、`eslint .` exit 0。

- [x] **逐 API 的认证判定（`allowAnonymous` 可以是谓词）**（已实现，2026-10-12）
  - 不在 transport 上开逐 API 开关，而是让策略拿到寻址结果与工具实例：`RpcIdentityContext` 新增 `toolId` / `act` / `resId` / `tool`（`src/transports/identity.ts:71-81`；曾加过 `builtin`，第三轮删），`server.ts:292` 的 `resolveRequestIdentity` 备料，`resolveRouteTool`（`:355`）按 dispatcher 的解析顺序取实例（取不到就 undefined，不抢 dispatcher 的 404），`matchedPrefix`（`:426`）供多租户。
  - `RpcBearerPolicy.allowAnonymous` 接受 `boolean | (ctx) => boolean`（`src/transports/identity-bearer.ts:32`，实现 `:70` / `:76`）：布尔是全 transport 一刀切，谓词是逐请求/逐 API。工具注册级元数据直接读 `ctx.tool` 上自带的字段（继承 `ServerTools` 加字段即可），字段名是部署与业务的私有约定，框架不读不解释。
  - 待定（未做）：路由级声明上要不要再开一个显式的「这条前缀必须认证」开关——目前 `ctx.prefix` / `ctx.apiUrl` 已足够策略自己判；工具注册上同理（已有 `tool` 可读，不再加 `requireIdentity` 这类字段）。

- [ ] **客户端侧 `credentialSource` 只有类型，没接线**（未实现，不在 P0/P1 范围）
  - `RpcCredentialSource` 已导出（`src/transports/identity.ts`），但 `ClientToolTransportOptions` 没有这个选项：写进哪个 header 由部署的 transport 定（契约 11），所以上游没定 per-transport 的落点。
  - 今天能用的写法：`someTool.run(params, { headers: { authorization: 'Bearer …' } })`（`fetchOptions.headers` 透传，`src/transports/client.ts:119-127`）；类级 `ClientTools.fetchOptions` 会被合进每次调用（含发现调用，`src/client-tools.ts:127`、`:190-193`）。

- [ ] **下游收口：`@isdk/tool-event`**（未实现，排在本包发布之后）
  - 下面 `src/...` 与 `sse-*.ts` 均在 **`@isdk/tool-event` 仓**，不在本仓，行号无法在本仓回核。
  - 它**已经**从 RPC header 取 clientId：`src/transports/pubsub/sse-server.ts:77` 的 `getSessionFromReq`；客户端把服务端发的 id 回写进 header（`src/event-client.ts:89-94` → 本包 `src/transports/client.ts:124-127`）。收口后 `getSessionFromReq` 改走 identity。
  - 原实现位置：`src/utils/sse-identity.ts`（172 行，`SSETokenIdentityPolicy` 在 :112）与 `src/utils/sse-channel.ts`（425 行，welcome 帧反查在 :359）。
  - **默认值不等价**：原实现 `maxUses` 默认 5（`sse-identity.ts:121`），框架侧默认不限 → 收口要显式传 `maxUses: 5` 才与今天同行为。
  - 它的三张表都以 clientId 为 key（`sse-channel.ts:44` / `:56`、`sse-server.ts:28`），所以 `id` 必须是连接级。

- [ ] **`@isdk/tool-electron`：要在 IPC 上装策略，先给 payload 开凭证字段**（未实现，可选）
  - 下面 `src/...` 均在 **`@isdk/tool-electron` 仓**，不在本仓。
  - 它的 transport 走共用流水线（`src/ipc-server.ts:60` `extends ServerToolTransport`、:192 `processIncomingCall`），不改也能跑；但 `src/ipc-server.ts:217` 的 `headers` 是空对象、`src/pubsub/electron-client.ts:140` 写 `clientId: ''`，凭证没有承载处。

- [ ] **`@isdk/tool-rpc-fastify`：装配时传 `identity` + `credentialReader`**（未实现）
  - `src/fastify-server.ts` 在 **`@isdk/tool-rpc-fastify` 仓**，不在本仓。
  - 不用改 `src/fastify-server.ts:340` 那行（未装策略时就是透传）。注意它的 `Req` 是 `FastifyRequest`，Node 对象在 `raw._req` / `raw._res`（:345）。

- [x] **文档：身份策略单开一节**（已实现，2026-10-12）
  - `src/transports/README.cn.md` 新增「§9 身份策略（服务端运行时）」（后面的节次整体后移）；§8.0 那张传输层 helper 表保持两个文件，没动。
  - `README.md` / `README.cn.md` 新增使用者章节（两个默认实现 + 差异表 + 策略接口）；`AGENT.md` 同步（ToolRpcRequest 表加 `identity` 行、§4.4 加「自报值不是身份」、新增 §4.6）。
  - 没写 tool-event 的事件协议细节。
  - 服务端运行时那一层单开一节，**不进** `src/transports/README.cn.md` §8.0 那张传输层 helper 表（那张表保持两个文件）；`README.md` / `README.cn.md` 加使用者章节（先两个默认实现与差异表，再策略接口）；`AGENT.md` 同步。不写 tool-event 的事件协议细节。

- [x] **废弃项要说清「现在怎么写」：`setTransport` / `mount` + 测试不再用废弃入口**（已实现，2026-10-12 第五轮）
  - 上一轮只给 `addDiscoveryHandler` 标了 `@deprecated`，说明里没写替代写法；顺带查出 `ClientTools.setTransport` 同样只标不指路，
    而且它的 JSDoc 格式是坏的。现在三处都写清「改用什么」：`src/client-tools.ts:71-90`（两条路径：只有地址 → `connect()`/`apiUrl` + `loadFrom()`；
    已自构实例 → `RpcClientTransportManager.instance.register(transport)` + `Class.apiUrl = transport.apiUrl`）。
  - `ClientToolTransport.mount(Class)` 也标 `@deprecated`（`src/transports/client.ts:36-52`）：它现在只把 `apiUrl` 写到类上，
    所以替代就是那一行赋值。只有 `setTransport` 在调它，无别的调用点。
  - 手写文档补迁移路径：`AGENT.md` 迁移表里 `setTransport` / `addDiscoveryHandler` 两行给出可抄的替代；
    `src/transports/README.cn.md` §12 开头点明废弃并新增 §12.3「预构 transport 实例」（mailbox 要 `clientAddress` 那种只能自构的场景）；
    `TRANSPORT_REFACTOR_DESIGN.cn.md` §7 把「setTransport 适配器」那条改成带替代写法与废弃理由的条目。
  - 测试里非「故意测兼容外壳」的废弃调用全部迁走：`addDiscoveryHandler` 去掉 14 处（`test/` 10 处纯冗余，紧邻同一前缀的 `addRpcHandler`；
    `mailbox-transport.test.ts` 4 处）。保留的只有真在测外壳的：`route-claims` / `route-table`（重复声明与迁移提示）、
    `discovery-e2e`（清单来自 handler）、`http-server.test.ts`（嵌套前缀的发现行）、`mailbox-server.test.ts`（mailbox 侧同一件事）、
    各 probe 的抽象方法实现。
  - `mailbox-transport.test.ts` 改用 `addRpcHandler(addr, { registry })`，顺带暴露一个真问题：它以前靠 `dispatcher.registry = …`
    挂注册表，而 `dispatcher` 是 `RpcServerDispatcher.instance` 单例，两个 mailbox transport 互相覆盖（旧写法靠 per-prefix 的
    discoveryHandler 掩盖了）。按前缀挂之后各列各的清单。
  - `setTransport` 迁走 13 处（`src/transports/mailbox-transport.test.ts` 3、`test/` 10）→ `register(transport)` + `Class.apiUrl = transport.apiUrl`。
    兼容外壳本身改由 `test/client-tools.test.ts` 一条用例钉住：`setTransport(t)` 等价于「按 `t.apiUrl` 登记 + 把地址写到类上」，
    且之后 `getClient(apiUrl)` 拿到的就是同一个实例。
  - **检查**（2026-10-12 实测）：`vitest run` **51 文件 / 668 通过**（上一基线 51/667，新增即上面那条）；
    `tsc -p tsconfig.json` 与 `-p tsconfig.release.json` 均 0；`eslint .` 0；
    `typedoc --plugin typedoc-plugin-markdown --out docs/api` 0 errors（18 条外部符号链接 warning，与本轮无关），
    生成物里 `~~addDiscoveryHandler()~~` / `~~setTransport()~~` / `~~mount()~~` 三处都渲染成删除线。
