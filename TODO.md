# TODO - tool-rpc

> 2026-10-11 逐项对着代码核过一遍：已实现的标 `[x]` 并附证据行号，未实现的标 `[ ]` 并写明当前实况。

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
