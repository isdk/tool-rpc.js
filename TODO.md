# TODO - tool-rpc

> 已实现条目只留一行摘要（细节在对应设计与测试文件里）；未实现条目保留实况与目标。

## ClientTools 架构优化

- [ ] **优化 `ClientTools.connect` 的元数据复用**（未实现）
  - **现状**: `connect` 创建子类后仍重置 `items = {}`（`src/client-tools.ts`，注释写明是「Scope isolation for discovered stubs」），每个连接实例都要重新 `loadFrom` 填充工具桩。没有 `with({apiUrl})`，也没有靠原型链共享 `items`。
  - **目标**: 所有连接实例（BoundService）共享同一套工具定义（Metadata），仅在请求终点（`apiUrl`）和执行配置上保持独立。
  - **思路**:
    - 考虑使用类似 `with({apiUrl})` 的模式，利用原型链继承 `items`。
    - 确保工具实例在执行 `fetch` 时能够正确获取到所属子类/实例的 `apiUrl`。
    - 避免每个实例都执行一次 `loadFrom` 的远程获取过程。
  - **注意**: 共享 `items` 与现有「Scope isolation」是同一处代码的两个诉求，改动要说明隔离性怎么保（同名工具在不同 apiUrl 上的桩不能互相污染）。

- [x] **增强 `loadFrom` 的灵活性** — `loadFrom(items?)` 传入 `items` 时跳过网络 fetch，直接 `loadFromSync(items, apiUrl)`（`src/client-tools.ts`）。

## 传输层默认值

- [ ] **`RPC_DEFAULTS.GLOBAL_TIMEOUT_MS` 定义了但无人消费**
  - `src/transports/models.ts` 声明默认全局硬超时 30000，**生产代码零消费**：全仓除定义处外，唯一命中是 `src/transports/models.test.ts` 断言这个常量本身的值。
  - 实况：默认值散在各处各写各的——`mailbox-client.ts` 的 `options.timeout || 30000`、`mailbox-client.ts` 的 `timeoutValue()` 兜底 30000。
  - **目标**: 默认超时从 `RPC_DEFAULTS` 单点取，避免默认值漂移；顺带确认 HTTP 侧的默认超时是否同一来源。

## 流式（streaming）

- [ ] **分片流的顺序重组与 RPC 层背压（`RpcStreamReassembler`）**（未实现，未排期；提案见 `RFC_STREAM_REASSEMBLY.cn.md`）
  - **实况**：流以单条物理通道直传——HTTP 侧 `Readable.fromWeb` 桥接（`src/transports/http-server.ts`），无分片、无序号、无重传。全仓 grep `RpcStreamReassembler` / `sequenceNumber` 除 RFC 本身外零命中，**不要当现状引用**。
  - 能力判定是**后置**的：`processIncomingCall` 在 dispatch 之后查 `!this.canStream`，把流改写成 `400 bad_request`（`src/transports/server.ts`）；基类默认 `false`，HTTP 置 `true`（`src/transports/http-server.ts`）。能力由服务端单方面声明，协议两侧无握手。
  - 生命周期收尾只有一个钩子：`createCallbacksTransformer({ onClose })`，`status: 'final' | 'error' | 'cancel'`（`src/transports/dispatcher.ts`）；`TransformStream` 本身没有 cancel 钩子，客户端侧靠自建流的 `underlyingSource.cancel`（`src/transports/http-client.ts`）。
  - **目标**：分片型协议（Mailbox 这类消息通道）上搬运 `ReadableStream` 时，按 `seq` 重排 + 去重 + 有界重排窗口，缺口超时即终止流；RPC 层要有流量反馈，而不是只靠 Web/Node 流自身队列。
  - **先决**：RFC §4 六个开放问题先定（序号归属、能力协商、背压回传通道、内存上界与 `retention` 计时起点、错误分片传播、与 102 轮询的关系），再动 `ToolRpcResponse` 的流契约。

## 测试

- [ ] **Web Worker Test**（未实现）
  - `package.json` 里没有 `@vitest/web-worker`，也没有 worker 集成测试（现有 `worker` 命中都是 vitest 的 worker 进程注释与 `worker_threads` 导出名单，见 `test/browser-entry.test.ts`）。
  - 目标：安装 `@vitest/web-worker`，创建真正的集成测试（PostMessage + 完整 RPC 循环）。

- [x] **排查 RpcError 问题** — `RpcError` 已定义并导出，公开面钉在 `test/browser-entry.test.ts`，并有传播测试（`test/browser-rpc-integration.test.ts`、`src/transports/models.test.ts`）。
  - **残留（未实现）**: 现有传播测试抛的是 plain `Error` + `.code`（`browser-rpc-integration.test.ts`），缺一条「工具 `func: () => { throw new RpcError(...) }`」的箭头函数回归用例——正是原报的写法。

- [ ] **Service Worker 测试**（未实现）
  - 无任何 Service Worker 相关测试。目标：添加 Service Worker RPC 测试。

## 身份策略（identity）

- [x] **身份策略（identity）** — 设计定稿在 `IDENTITY_POLICY_DESIGN.cn.md`。
