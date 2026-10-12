# TODO - tool-rpc

> 2026-10-11 逐项对着代码核过一遍：已实现的标 `[x]` 并附证据行号，未实现的标 `[ ]` 并写明当前实况。
> 2026-10-12 新增「身份策略」一节（设计定稿见 `IDENTITY_POLICY_DESIGN.cn.md`，那一节的行号也是当日实测）。

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
  - `loadFrom(items?, options?)` 在传入 `items` 时**跳过网络 fetch**，直接走 `loadFromSync(items, apiUrl)`（`src/client-tools.ts:98-110`，`loadFromSync` 定义于 `:118`）；只有 `items` 缺省时才 `transport.loadApis()`。
  - 「从已有的元数据（如父类的 `items`）同步定义」这条诉求已经满足，无需再实现。

## 传输层默认值

- [ ] **`RPC_DEFAULTS.GLOBAL_TIMEOUT_MS` 定义了但无人消费**
  - `src/transports/models.ts:36` 声明默认全局硬超时 30000，**生产代码零消费**：全仓除定义处外，唯一命中是 `src/transports/models.test.ts:20` 断言这个常量本身的值。
  - 实况：默认值散在各处各写各的——`mailbox-client.ts:51` 的 `options.timeout || 30000`、`mailbox-client.ts:99` 的 `timeoutValue()` 兜底 30000。
  - **目标**: 默认超时从 `RPC_DEFAULTS` 单点取，避免默认值漂移；顺带确认 HTTP 侧的默认超时是否同一来源。

## 测试

- [ ] **Web Worker Test**（未实现）
  - `package.json` 里没有 `@vitest/web-worker`，也没有 worker 集成测试（现有 `worker` 命中都是 vitest 的 worker 进程注释与 `worker_threads` 导出名单，见 `test/browser-entry.test.ts:39`）。
  - 目标：安装 `@vitest/web-worker`，创建真正的集成测试（PostMessage + 完整 RPC 循环）。

- [x] **排查 RpcError 问题**（症状已解决）
  - `RpcError` 已定义并导出（`src/transports/models.ts:150`），公开面钉在导出名单里（`test/browser-entry.test.ts:55`，Node/browser 两个入口都断言 `toBeDefined()`，`:147`），并有传播测试（`test/browser-rpc-integration.test.ts:700+`、`src/transports/models.test.ts:34,48`）。原报的「not defined」不可能再来自导出层。
  - **残留（未实现）**: 现有传播测试抛的是 plain `Error` + `.code`（`browser-rpc-integration.test.ts:709-713`），缺一条「工具 `func: () => { throw new RpcError(...) }`」的箭头函数回归用例——正是原报的写法。

- [ ] **Service Worker 测试**（未实现）
  - 无任何 Service Worker 相关测试。目标：添加 Service Worker RPC 测试。

## 身份策略（identity）

设计定稿在 `IDENTITY_POLICY_DESIGN.cn.md`（v2.1）。分期见它的 §11，逐项清单见 §14。下面只记「代码里现在有什么/缺什么」。

- [ ] **三个文件与 11 个公开符号**（未实现）
  - **现状**（2026-10-12 实测）：`src/transports/identity.ts` / `identity-session.ts` / `identity-bearer.ts` 均不存在；服务端只有客户端自报的 `clientId?: string`（`src/transports/models.ts:101`，header 是 `RPC_HEADERS.CLIENT_ID` = `rpc-client-id`，`:21`），身份没有任何判定落点。
  - **先改名单再动代码**：`test/browser-entry.test.ts` 加 `EXPECTED_IDENTITY_TYPES`。断言要写成**运行时 import 两个入口**（照 `:199` 的 `should export only the address helpers a transport needs`）——文件末尾那两条 dist 断言在未构建时会 skip，不会红。
  - **导出落点**：`src/transports/index.ts` 与 `src/transports/browser.ts` 走**显式**导出（那两个入口其余是 `export *`，靠它带出的符号没人钉）。
  - **行为落点**：`ServerToolTransport.processIncomingCall`（`src/transports/server.ts:187`），插在 `toRpcRequest`（:189）与 `validateRpcRequest`（:192）之间，这样 Manager 的 SSRF/拦截钩子能看到 `request.identity`。
  - **检查**：`./node_modules/.bin/tsc --noEmit -p tsconfig.release.json`、`./node_modules/.bin/tsc --noEmit -p tsconfig.json`、`npx vitest run`、`npx tsup --dts --dts-resolve`。基线（2026-10-12）：两份 tsc exit 0、`eslint .` exit 0（0 条）、`vitest run` 44 文件 / 539 通过。

- [ ] **内置登记表的第二索引与内存有界单测**（未实现）
  - `ensureCredential(identityId)` 按**身份**找凭证，而 `entries` 按**凭证**为 key → 必须有 `identityId → credential` 第二索引。
  - 对照物：`@isdk/tool-event` 的原实现是线性扫两处（`src/utils/sse-identity.ts:148` 的 `credential`、`:160` 的 `revoke`），一万条时不能这么写。
  - 单测要钉「大量闲置身份后条目数有界」（框架侧无定时器，清理只发生在 `lookupIdentity` 命中作废项与 `ensureCredential` 满容量两处）。

- [ ] **下游收口：`@isdk/tool-event`**（未实现，排在本包发布之后）
  - 它**已经**从 RPC header 取 clientId：`src/transports/pubsub/sse-server.ts:77` 的 `getSessionFromReq`；客户端把服务端发的 id 回写进 header（`src/event-client.ts:89-94` → 本包 `src/transports/client.ts:118-121`）。收口后 `getSessionFromReq` 改走 identity。
  - 原实现位置：`src/utils/sse-identity.ts`（172 行，`SSETokenIdentityPolicy` 在 :112）与 `src/utils/sse-channel.ts`（425 行，welcome 帧反查在 :359）。
  - **默认值不等价**：原实现 `maxUses` 默认 5（`sse-identity.ts:121`），框架侧默认不限 → 收口要显式传 `maxUses: 5` 才与今天同行为。
  - 它的三张表都以 clientId 为 key（`sse-channel.ts:44` / `:56`、`sse-server.ts:28`），所以 `id` 必须是连接级。

- [ ] **`@isdk/tool-electron`：要在 IPC 上装策略，先给 payload 开凭证字段**（未实现，可选）
  - 它的 transport 走共用流水线（`src/ipc-server.ts:60` `extends ServerToolTransport`、:192 `processIncomingCall`），不改也能跑；但 `src/ipc-server.ts:217` 的 `headers` 是空对象、`src/pubsub/electron-client.ts:140` 写 `clientId: ''`，凭证没有承载处。

- [ ] **`@isdk/tool-rpc-fastify`：装配时传 `identity` + `credentialReader`**（未实现）
  - 不用改 `src/fastify-server.ts:340` 那行（未装策略时就是透传）。注意它的 `Req` 是 `FastifyRequest`，Node 对象在 `raw._req` / `raw._res`（:345）。

- [ ] **文档：身份策略单开一节**（未实现）
  - 服务端运行时那一层单开一节，**不进** `src/transports/README.cn.md` §8.0 那张传输层 helper 表（那张表保持两个文件）；`README.md` / `README.cn.md` 加使用者章节（先两个默认实现与差异表，再策略接口）；`AGENT.md` 同步。不写 tool-event 的事件协议细节。
