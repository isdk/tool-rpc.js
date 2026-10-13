# RFC：流分片与重组（`RpcStreamReassembler`）

> **状态：草案（未实现，未排期）**
>
> 本文件从 `TRANSPORT_REFACTOR_DESIGN.cn.md` §5.2 拆出。那份文档是**已落地架构的规格**，
> 本节描述的东西**代码里不存在**——全仓 grep `RpcStreamReassembler` 与 `sequenceNumber`
> 除本文件外零命中。不要把这里的帧格式、头名、类名当现状引用。
>
> 追踪条目：`TODO.md`「流式（streaming）」一节。

---

## 1. 为什么要单独拆出来

`TRANSPORT_REFACTOR_DESIGN.cn.md` 是 v2 传输层的实现规格，读者会按「照着写就能跑」的方式用它。
原文里夹了一条「重组技术规范（尚未实现）」，混在已实现条目中间，容易被当成既有能力照抄
（分片序号、背压反馈这些一旦写进第三方 transport 就是空转的代码）。所以拆成本 RFC，
把「现在有什么」和「提案要加什么」分开写。

---

## 2. 现状：流式在 v2 里到底怎么走的（实测）

以下每条都在当前代码里核对过，行号是 2026-10-12 实测。

### 2.1 能力声明与拦截

- `IServerToolTransport.canStream?: boolean`（`src/transports/server.ts`），基类默认 `false`，
  HTTP 服务端置 `true`（`src/transports/http-server.ts`）。
- 拦截发生在 **dispatch 之后**（`src/transports/server.ts`）：若 `!this.canStream` 且
  `rpcRes.data` 是 `ReadableStream`（或鸭子类型 `typeof data.getReader === 'function'`），
  把响应改写成 `400` / `status: 'bad_request'`，并把 `data` 置 `undefined`。
  注意这是**后置**判定，不是预检：流已经产生、工具已经执行，只是不往外发。
  （`TRANSPORT_REFACTOR_DESIGN.cn.md` §5.2 说的「能力预检」指的就是这一处，名字比实况强。）
- 能力是服务端单方面声明的，**协议两侧没有握手**：客户端不知道对端 `canStream` 是真是假，
  也不存在能力协商帧。

### 2.2 生命周期观测（Dispatcher 侧）

- 鸭子类型判定 `typeof result.getReader === 'function' && typeof result.cancel === 'function'`
  （`src/transports/dispatcher.ts`），命中后取 `this.tracker.get(request.requestId)` 拿 Handle。
- 用 `@isdk/tool-func` 的 `createCallbacksTransformer({ onClose })`（`src/transports/dispatcher.ts`）
  包一层 `pipeThrough`，再 `handle.setOutputStream(result)`
  让 Handle 在逻辑中止时能主动 `cancel` 流。
- 收尾钩子只有 **`onClose(status, reason)`** 一个，`status` 是 `'final' | 'error' | 'cancel'`
  （`@isdk/tool-func` 的 `StreamCloseStatus` / `StreamCallbacksAndOptions`，见
  `node_modules/@isdk/tool-func/dist/index.d.ts` 与）。
  `TRANSPORT_REFACTOR_DESIGN.cn.md` §5.2 旧版曾把它拆成「`flush` 钩子」与「`cancel` 钩子」两条，
  已于 2026-10-12 改回单一 `onClose`：`TransformStream` 本身没有 cancel 钩子，
  第三个参数按规范只读 `highWaterMark`/`size`，且 `flush` 在 cancel 时不跑
  （`src/transports/README.cn.md` §流式生命周期处有 Node 22 实测说明）。
- Handle 侧成员：`isStream` / `streamPending`（`src/transports/task-tracker.ts` /）、
  `setOutputStream()`、`markStreamFinished()`；retention 的计时从流结束起算。

### 2.3 物理搬运：单通道直传，无分片无序号

- HTTP 侧把 Web 流桥到 Node 网络层：`Readable.fromWeb`（`src/transports/http-server.ts`）。
  **一条物理通道从头传到尾，没有分片、没有序号、没有重传。**
- 因此当前不存在「乱序 / 重复 / 缺口」问题，也就不需要重组器。
  重组器要解决的问题只在**分片型协议**上出现（Mailbox 这类消息型通道、或未来 HTTP 上的分帧续传）。
- 背压目前完全交给 Web/Node 流自身的队列 + `Readable.fromWeb` 的桥接（`src/transports/README.cn.md` §流式背压），
  **RPC 层没有任何流量反馈**：没有窗口、没有 ack、没有 `rpc-` 前缀的流控头。
- 客户端侧的取消感知另走一路：自建 `ReadableStream` 的 `underlyingSource.cancel`
  （`http-client.ts` 的 `cancelAware()`，见 `src/transports/http-client.ts`），
  这是规范里唯一保证被调的 cancel 钩子。新 transport 要接 cancel 只有这一条路。

---

## 3. 提案：`RpcStreamReassembler`

### 3.1 要解决的问题

在分片型传输上搬运一个 `ReadableStream`：

1. 分片可能**乱序**到达（并发投递、多消费者）。
2. 分片可能**重复**（at-least-once 语义，Mailbox 的 ack 失败重投就是这种）。
3. 分片可能**缺失**（消息过期、消费失败）。
4. 接收端内存必须有界：不能为了重排把整条流攒下来。

### 3.2 最小形状（待议，不是定稿）

- **帧**：`{ seq: number, eof?: boolean, chunk }`。序号由**谁**生成待定（见 §4）。
- **重排窗口**：有界窗口（例如 `windowSize`），窗口满即对上游形成背压；缺口超过 `gapTimeout` 判定为丢片，
  以 `RpcError` 终止流（错误码待定，倾向复用 `408`/`504` 语义而不是新造）。
- **去重**：按 `seq` 幂等丢弃已交付过的分片。
- **收尾**：`eof` 分片 + 窗口排空 → 正常 close；任何缺口/超时 → 走 `onClose('error'|'cancel')` 那条既有路径，
  不新增生命周期钩子。
- **与 Handle 的关系**：重组后的流仍然只交给 `dispatcher` 现有的 `setOutputStream()` / `markStreamFinished()`，
  即重组器是 **transport 内部**的组件，不侵入 Dispatcher 与 TaskTracker。

### 3.3 明确不做（非目标）

- 不做跨请求的多路复用、不做 QUIC 式选择性重传、不做端到端拥塞控制。
- 不引入 `rpc-priority` 之类的优先级头（优先级至今未实现，与重组无关）。
- 不改变 §2.1 的 `canStream` 拦截语义：在重组器落地前，非流式协议上返回流**仍然**是 400。

---

## 4. 开放问题（落地前必须先定）

1. **序号归属**：`seq` 由 dispatcher 统一生成（跨协议一致，但要改 `ToolRpcResponse` 的流契约），
   还是各 transport 自己编号（改动局部，但第三方实现各写各的，去重语义难统一）。
2. **能力协商**：客户端怎么知道对端能不能收分片流？现在只有服务端单方面 `canStream`。
   要不要在发现端点（内置 `rpcApis`）的返回里带 transport 能力？
3. **背压反馈通道**：窗口/ack 走消息体还是走 header？HTTP 侧没有回传通道（单向响应流），
   Mailbox 侧有——两条路的语义必须能统一，否则又变成 per-transport 特例。
4. **内存上界与 retention 的相互作用**：后台任务（`keepAliveOnTimeout`）+ 分片保留，
   最坏情况驻留多少内存；`retention` 的计时起点（现在是流结束，见 `task-tracker.ts`）在分片场景下是否仍成立。
5. **错误传播**：单个分片解码失败是终止整条流还是跳过？终止的话错误码与 `status` 串取什么。
6. **与 102 轮询的关系**：轮询路径（`client.ts` 的 `pollTaskStatus`）返回的是完整结果对象，
   分片流在轮询模型下如何续传（还是说分片流明确不支持轮询，写进非目标）。

---

## 5. 落地时的文档同步清单

- `TRANSPORT_REFACTOR_DESIGN.cn.md` §5.2：把指向本 RFC 的条目改成「已实现」并回指实现。
- `src/transports/README.cn.md`：Header 表（若新增帧/流控头）、状态码表（若新增错误码）、
  「新 transport 怎么接 cancel」那节。
- `README.md` / `README.cn.md` / `AGENT.md`：Mailbox 等协议是否支持流式输出的说法要改。
- `TODO.md`：勾掉对应条目并附证据行号。
