# Mailbox 传输层 (Mailbox Transport)

`MailboxTransport` 是 `@isdk/tool-rpc` 的一个异步、消息驱动的传输实现。它基于 `@mboxlabs/mailbox` (Actor 模型)，将“一切通信视为投递信件”。

## 1. 设计哲学：地址即身份 (Addressing as Identity)

不同于 HTTP 传输层依赖于层级的 URL 路径和同步的请求/响应循环，Mailbox 传输层强调：
- **物理地址 (Physical Address)**: `protocol://user@host`。这是消息能够送达的最小单位，由具体的 `MailboxProvider` 负责路由。
- **逻辑路径 (Logical Path)**: `/toolName`。这是服务内部的功能分发，由 `tool-rpc` 传输层负责路由。

### 为什么不直接使用 URL Pathname 路由？
虽然 URL 规范支持层级路径（如 `mem://server/api/calculator`），但在消息世界中，这会带来以下难题：
1. **精确匹配限制**: 许多轻量级 Provider（如内存总线、简单的 MQ）仅支持地址的精确匹配。如果为每个工具都订阅一个独立的 URI，会极大增加订阅成本和系统复杂度。
2. **协议兼容性**: 许多扁平化的协议（如 `tel:`, `slack:`, `mailto:`）天然不具备路径概念。

**决策：** 我们将 `apiRoot` 视为物理邮箱的“访问点”。具体的工具 ID (`toolId`) 优先通过消息体 (`body.name`) 携带，从而确保在所有协议上都能保持一致的路由行为。

## 2. 消息协议规范 (Protocol Specification)

### 2.1 头部信息 (Headers)
为了避免与标准 HTTP 或其他中间件 Header 冲突，且符合 `mailbox` 生态习惯，所有自定义 Header 均使用 `mbx-` 前缀：

- `mbx-req-id`: 请求的唯一标识符（UUID）。
- `mbx-res-to`: 响应消息中携带，指向原始请求的消息 ID。
- `mbx-sent-at`: (由 Mailbox 核心注入) 消息发送的 ISO 时间戳。
- `mbx-path`: (可选) 逻辑路由路径，作为 `body.name` 的补充或替代。

### 2.2 消息体 (Body)
请求消息体通常包含：
- `name`: 目标工具 ID (`toolId`)。
- `act`: 动作名称（如 `get`, `post`, `list` 等）。
- `...args`: 工具执行所需的参数。

## 3. 工作流程 (Workflow)

### 3.1 客户端 (Client)
1. **挂起队列**: 内部维护一个 `Map<requestId, { resolve, reject, timer }>`。
2. **发送请求**: 
   - 生成 `mbx-req-id`。
   - 构造 `MailMessage`，`to` 为服务器 `apiRoot`，`from` 为客户端回信地址。
   - 调用 `mailbox.post(message)`。
3. **异步接收**: 
   - 在 `mount` 时订阅自己的回信地址。
   - 收到消息后，根据 `mbx-req-id` 查找并 `resolve` 对应的 Promise。
4. **超时处理**: 默认 30s 超时，防止挂起的请求导致内存泄漏。

### 3.2 服务器 (Server)
1. **订阅监听**: 启动时通过 `mailbox.subscribe(listenAddress)` 监听物理邮箱。
2. **逻辑分发**:
   - 优先检查 `body.name`。
   - 作为备选，检查 `to.pathname` 是否匹配 `apiRoot` 后缀。
3. **上下文注入**: 将原始 `MailMessage` 注入 `params._req`，以便工具函数获取发件人地址等元数据。
4. **异步回信**: 执行完毕后，自动向 `message.from` 发送回信，并携带相同的 `mbx-req-id`。

## 4. 与 tool-event (Pub/Sub) 的集成思路

Mailbox 传输层天然适合支持 `tool-event` 的数据平面：
- **无连接状态**: 不同于 SSE 需要维持 HTTP 长连接，Mailbox 模式下 `EventServer` 只需在事件发生时向订阅者的 `clientAddress` “邮寄”一封信即可。
- **离线能力**: 如果使用了具备持久化能力的 Provider（如邮件或 MQ），客户端甚至可以在重连后收到离线期间的事件。

## 5. 开发建议

- **Provider 选择**: 单元测试和单进程开发优先使用 `MemoryProvider`。分布式部署可选用基于 Redis、MQTT 或自定义协议的 Provider。
- **地址规范**: 建议所有自定义协议地址使用 `//` 风格（如 `mem://api@server`），以确保 `URL` 对象能够正确解析 `pathname`。
