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

### 4.1 优先级协商

当发起一个 RPC 调用时，最终生效的超时时间取以下各方的**最小值**：

1. **客户端全局默认值** (Client Global Default)
2. **工具元数据建议值** (Tool Metadata / Discovery)
3. **调用时手动指定的参数** (Manual Call Options)
4. **服务端硬性限制** (Server Hard Limit)

### 4.2 传输层协议约定 (Transport Headers)

- **标准 Header (V2)**:
  - `rpc-timeout`: 客户端告知其最终确定的等待时长 (单位: ms)。
  - `rpc-request-id`: 本次调用的唯一标识。在触发 102 状态后，用于后续的状态轮询。
  - `rpc-trace-id`: 全链路追踪 ID，用于跨服务日志关联。
- **状态码 (V2)**:
  - **102 Processing**: **软死线 (Soft Deadline) 触发**。服务端响应超时，但任务已转入后台继续运行。客户端应根据 `Retry-After` 头进行轮询。
  - **408 Terminated**: **硬死线 (Hard Deadline) 触发**。任务运行时间超过服务端设定的物理上限（如 `maxTaskRuntimeMs`），被强制终止。
  - **409 Conflict**: `requestId` 冲突。表示该 ID 的任务已在账本中激活。
  - **504 Gateway Timeout**: 客户端等待超时，且任务不具备后台维持能力。
  - **错误负载**: 返回标准响应对象 `{ status: 504, error: { code: 504, message: 'TIMEOUT', ... } }`。

---

## 5. 清理与信号机制 (Cleanup & Signals)

### 5.1 AbortSignal 注入

- **服务端**: `ServerTools.run(params)` 的 `params` 中必须注入 `_signal: AbortSignal`。同时，业务逻辑可以通过 `this.ctx.signal` 访问该信号。
- **行为**: 当传输层触发超时（或客户端断开连接）且 `keepAliveOnTimeout` 为 `false` 时，该信号会被触发 (`abort`)。工具函数内部应通过监听此信号来停止耗时操作（如停止 AI 模型生成、中断 DB 查询）。

### 5.2 物理与逻辑中止联动 (V2)

- **物理中止**: 当物理链路断开（如 TCP Reset）时，服务端的 `HttpServerToolTransport` 应感知此事件并调用 `context.abort()`，从而中止关联的本地任务。
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

---

## 7. 工具发现 (Discovery)

- `ServerTools.toJSON()` 必须包含 `timeout` 和 `expectedDuration` 字段。
- 客户端在 `loadFrom()` 时应自动将这些值注入到动态生成的 `ClientTools` 实例中。
