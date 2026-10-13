# @isdk/tool-rpc 超时处理规范 (Specification v1.0)

## 1. 核心定义 (Core Definitions)

### 1.1 超时类型

- **硬超时 (Timeout / Worst Case)**: 强制中断任务并释放资源的最后期限。系统保障的底线。
- **预估时长 (Expected Duration)**: 工具正常执行的统计平均耗时（非强制性约束）。用于优化用户感知和客户端调度策略。

### 1.2 超时配置结构

工具元数据中的 `timeout` 属性支持以下格式：

- **简写 (number)**: 毫秒数，代表硬超时时间。
- **详写 (Object)**:
  - `value: number`: 硬超时时间（毫秒）。
  - `streamIdleTimeout?: number`: 流式响应的空闲间隔（TTFB 或 Chunk 间隔，毫秒）。
  - `keepAliveOnTimeout?: boolean`: 超时后是否允许服务端继续在后台运行（默认 `false`）。

---

## 2. 元数据架构 (Metadata Schema)

修改 `RemoteFuncItem` 接口，增加以下字段：

```typescript
export interface RemoteFuncItem extends BaseFuncItem {
  /**
   * 超时配置：硬超时时长或精细化控制对象
   */
  timeout?: number | {
    value: number;
    streamIdleTimeout?: number;
    keepAliveOnTimeout?: boolean;
  };

  /**
   * 预估耗时：统计意义上的正常执行时间（毫秒）
   * 用于客户端 UX 优化和智能调度
   */
  expectedDuration?: number;
}
```

---

## 3. `expectedDuration` 细化建议 (UX & Strategy)

`expectedDuration` 并非强制约束，但客户端应利用该值提升用户体验：

### 3.1 进度条与加载动画 (UI Progress)

- **非线性进度模拟**:
  - 客户端可以基于 `expectedDuration` 模拟进度。
  - **策略**: 在 `0` 到 `expectedDuration` 时间内，进度条平滑增长至 80%-90%；若超过该时间仍未返回，进度条应进入“极慢增长”或“脉冲等待”状态，直至触及 `timeout.value`。
- **状态提示**:
  - 如果 `expectedDuration > 5000`ms，UI 可以提示：“任务正在处理中，通常需要约 X 秒...”

### 3.2 乐观重试与冗余请求 (Optimistic Retries)

- 对于**幂等 (Idempotent)** 工具：
  - 如果执行时间超过 `expectedDuration * 1.5` 且远未达到 `timeout`，客户端可以考虑发起一个并发的冗余请求（Hedged Request）以对抗偶发性的网络抖动或服务端单点卡顿。

### 3.3 客户端资源预热

- 客户端可以根据 `expectedDuration` 决定是否在等待期间执行其他后台任务（如预加载后续资源），以掩盖长耗时任务带来的停顿感。

---

## 4. 执行与优先级逻辑 (Execution & Priority)

### 4.1 优先级协商（实现现状）

死线分**两段**协商，不是四方取 min：

1. **客户端**（`ClientToolTransport.fetch()`）：在“调用时手动指定的 `timeout`”与“工具元数据 `timeout`”之间取**较小值**；
   只有一个存在就用那一个。`streamIdleTimeout` 同理。结果通过 `rpc-timeout` 头发出。
2. **服务端**（`RpcServerDispatcher.prepareContext()`）：按优先级取第一个**配了**的值：
   `header 值 → 工具元数据 timeout → dispatcher.globalTimeout`（默认 30000ms）。
   注意这里是**优先级回退**而非取小：header 一旦存在就直接采用（它已经是客户端算好的 min）。

#### `0` 的语义：明确无死线

每一级的 `0` 都是**显式声明**，与 `undefined`（没配）不同：

| 写法 | 含义 |
| :--- | :--- |
| `timeout: undefined` | 继承下一级，最终落到 `globalTimeout`。 |
| `timeout: 0` | **不要死线**：`globalTimeout` 也不参与。 |
| `timeout: { value: 0 }` | 同上（长写法）。 |
| `rpc-timeout: 0`（header） | 客户端明确声明无死线，服务端不拿 `globalTimeout` 兜底。 |
| `globalTimeout: 0` | dispatcher 不设全局兵底。 |

实现上就是 `readTimeoutHeader()` + `firstConfigured()`：只有 `undefined` / 读不出才算「没配」。
以前写的是 `clientTimeout || toolTimeoutObj.value || this.globalTimeout`，`0 || x === x`，
于是显式 `timeout: 0` 被隐式 `globalTimeout` 掉——与 `RpcDeadlineGuard`（`> 0` 才上弦）
以及注释里「0 = 不开死线」的说法相矛盾（issue #8）。内置发现端点 `rpcApis` 因此不再声明
`timeout: 0`（那个值以前根本无效，现在真生效了反而会让发现调用无限挂住）：
**发现调用该被全局超时掩住。** 真的不能被打断的工具自己显式写 `timeout: 0`。

另有两个与工具元数据无关的全局护栏：`dispatcher.globalTimeout`（兵底硬超时）与
`dispatcher.maxTaskRuntimeMs`（默认 1 小时，后台任务的绝对运行上限）。

### 4.2 传输层协议约定 (Transport Headers)

- **标准 Header (V2)**（完整定义见 `src/transports/models.ts` 的 `RPC_HEADERS`）:
  - `rpc-timeout`: 客户端告知其最终确定的等待时长 (单位: ms)。
  - `req-id`: 本次调用的唯一标识（**不是** `rpc-request-id`）。在触发 102 状态后用于后续状态轮询；响应必须回显。
  - `trace-id`: 全链路追踪 ID（**不是** `rpc-trace-id`），用于跨服务日志关联。
  - `rpc-fn` / `rpc-act` / `rpc-res-id`: 工具 id / 动作 / 资源 id。
  - `rpc-retry-after`: 102 响应里的轮询退避间隔（默认 `RPC_DEFAULTS.RETRY_AFTER_MS` = 1000ms）。
  - `rpc-client-id`: 客户端自报标识。
- **状态码 (V2)**:
  - **102 Processing**: **软死线 (Soft Deadline) 触发**。服务端响应超时，但任务已转入后台继续运行。客户端应根据 `Retry-After` 头进行轮询。
  - **408 Terminated**: **硬死线 (Hard Deadline) 触发**。任务运行时间超过服务端设定的物理上限（如 `maxTaskRuntimeMs`），被强制终止。
    **注意区分两条路径**：同步调用里硬死线会被 `handleError()` 再映射为 **504**（`status: 'timeout'`）；
    408 只出现在**轮询路径**（`rpcTask.get` 读到 `aborted` 任务）和账本内部的 `RpcError` 上。
  - **409 Conflict**: `requestId` 冲突。表示该 ID 的任务已在账本中激活。
  - **504 Gateway Timeout**: 客户端等待超时，且任务不具备后台维持能力。
  - **错误负载**: 返回标准响应对象 `{ status: 504, error: { code: 504, message: 'TIMEOUT', ... } }`。

---

## 5. 清理与信号机制 (Cleanup & Signals)

### 5.1 AbortSignal 注入

- **服务端**: `ServerTools.run(params)` 的 `params` 中必须注入 `_signal: AbortSignal`。同时，业务逻辑可以通过 `this.ctx.signal` 访问该信号。
- **行为**: 当传输层触发超时（或客户端断开连接）且 `keepAliveOnTimeout` 为 `false` 时，该信号会被触发 (`abort`)。工具函数内部应通过监听此信号来停止耗时操作（如停止 AI 模型生成、中断 DB 查询）。

### 5.2 物理与逻辑中止联动 (V2)

- **物理中止**: 当物理链路断开（如 TCP Reset）时，服务端的 `HttpServerToolTransport` 监听 `rawRes` 的 `close` 事件，
  通过 `dispatcher.tracker.get(requestId)` 拿到账本句柄并调 `handle.abort('Physical connection closed')`（内部即
  `aborter.abort(reason)`，会反映到 `ctx.signal`），从而中止关联的本地任务。
- **逻辑中止**:
  - **客户端取消**: 当用户在客户端触发 `AbortSignal` 时：
    1. 传输层立即尝试物理切断当前连接。
    2. 若任务已在后台执行（曾收到过 102），传输层必须向服务端发送 `POST /rpcTask/:requestId?act=$cancel`。
  - **服务端响应**: `RpcActiveTaskTracker` 接收到取消请求后，立即强制终止对应任务，触发任务的 `cleanup` 钩子并清理账本记录。

### 5.3 资源释放

- 超时触发后，传输层必须确保所有关联的流（Stream）和 Socket 连接被正确关闭。

---

## 6. 流式响应行为 (Streaming Behavior)

- **首字节超时 (TTFB)**: 从请求发出到接收到第一个 Chunk，时间不得超过 `streamIdleTimeout`（若未指定，则退化为 `timeout.value`）。
- **数据间隔超时 (Gap Timeout)**: 任意两个相邻 Chunk 之间的时间间隔不得超过 `streamIdleTimeout`。
- **处理方式**: 一旦触发，传输层应向应用层抛出超时异常并关闭连接。

### 6.1 传输层接入要求（适用于所有传输层）

超时与流语义由 `RpcServerDispatcher` 统一实现，因此**自定义服务端传输层应继承 `ServerToolTransport` 并复用它的 `processIncomingCall(rawReq, rawRes, registry?)`**（`src/transports/server.ts`，`protected`），而不是自己直接调 `dispatcher.dispatch()`。这一层差异不是风格问题：

| 经由 `processIncomingCall` | 自己 `dispatch` 会跳过 |
| --- | --- |
| 身份策略判定（`identity`）与 `manager.validateRpcRequest()`（SSRF / 协议白名单） | 架构级策略校验全部失效 |
| `requestRegistry()` 分层注册表视图（前缀 claim → transport → dispatcher → 系统） | 多前缀多注册表时工具解错、串注册表 |
| 传输层 `canStream` 能力后置检查（返回 400） | 不支持流的传输把流当普通对象序列化 |
| 错误归一化为 `ToolRpcResponse`（顶级防护） | 需自行实现错误体映射，容易不一致 |

> 流式意图与工具 `stream` 能力的冲突预检在 **dispatcher** 里（`resolveTool()` 中 `params.stream && !tool.stream` → 400），
> 与传输层的 `canStream` 后置检查（`server.ts`，工具返回流但协议不支持 → 400）是两个不同的关卡。

流式传输层还需在 `start()` 里挂上 `streamIdleTimeout`（首字节与相邻 chunk 间隔），并在 `stop()` 里销毁尚未结束的流（否则空闲流会泄漏）。参考实现：`HttpServerToolTransport`（`src/transports/http-server.ts`）。

> 已知缺口：`@isdk/tool-electron` 的 `IpcServerToolTransport` 目前直接调 `dispatcher.dispatch()`，因此上述三项预检均未生效（它也不读 `streamIdleTimeout`、`stop()` 不注销路由归属）。接入时应改为 `processIncomingCall`。

---

## 7. 工具发现 (Discovery)

- `ServerTools.toJSON()` 必须包含 `timeout` 和 `expectedDuration` 字段。
- 客户端在 `loadFrom()` 时应自动将这些值注入到动态生成的 `ClientTools` 实例中。
