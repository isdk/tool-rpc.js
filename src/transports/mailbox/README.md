# Mailbox 传输层 (Mailbox Transport)

`MailboxTransport` 是 `@isdk/tool-rpc` 的一个异步、消息驱动的传输实现。它基于 `@mboxlabs/mailbox` (Actor 模型)，将“一切通信视为投递信件”。

## 1. 设计哲学：地址即身份 (Addressing as Identity)

不同于 HTTP 传输层依赖于层级的 URL 路径和同步的请求/响应循环，Mailbox 传输层强调：

- **物理地址 (Physical Address)**: `protocol://user@host`。这是消息能够送达的最小单位，由具体的 `MailboxProvider` 负责路由。
- **Headers 路由**: 为了确保在所有协议（包括不支持路径的协议如 `mem`, `mailto`, `slack`）上都能保持一致的路由行为，`tool-rpc` 强制使用消息头（Headers）进行逻辑分发。

## 2. 消息协议规范 (Protocol Specification)

### 2.1 头部信息 (Headers) —— 唯一路由来源

为了确保路由的确定性、安全性和跨协议的一致性，Mailbox 传输层强制使用 Headers 进行路由分发。所有自定义 Header 均使用 `mbx-` 前缀：

- `mbx-fn-id`: **(强制)** 工具/函数标识符 (Function ID)。
- `mbx-act`: **(强制)** 操作动作 (Action)，如 `get`, `post`, `delete`, `list` 等。默认为 `post`。
- `mbx-req-id`: **(强制)** 请求的唯一关联 ID (Correlation ID)。
- `mbx-reply-to`: 响应应发往的目标邮箱地址。
- `mbx-res-id`: **(可选)** 资源标识符 (Resource ID)，用于标识特定的资源实例。
- `mbx-sent-at`: (由 Mailbox 核心注入) 消息发送的 ISO 时间戳。

## 3. 核心特性 (Core Features)

### 3.1 传输模式：Push vs Pull

- **Push (默认)**: 服务端通过 `subscribe` 被动接收消息。适合低延迟场景。
- **Pull**: 服务端通过 `fetch` 循环主动拉取消息。适合高可靠性、需要 **背压 (Backpressure)** 控制的场景。

```typescript
const server = new MailboxServerTransport({
  address: 'mem://api@server/api',
  mode: 'pull',
  pullInterval: 1000 // 1秒拉取一次
});
```

### 3.2 结构化错误处理

服务端返回符合标准规范的错误响应，包含 `code` 和 `data`。客户端会自动将其还原为带有属性的 `Error` 对象：

```json
{
  "error": "Resource not found",
  "code": 404,
  "data": { "fnId": "users", "resId": "123" }
}
```

## 4. 工作流程 (Workflow)

### 4.1 客户端 (Client)

1. **发送请求**:
   - 生成 `mbx-req-id`。
   - 注入 `mbx-fn-id`, `mbx-act` 等标准 Headers。
   - 将 `mbx-reply-to` 设置为自己的 `clientAddress`。
   - 调用 `mailbox.post(message)`。
2. **异步接收**: 收到消息后，根据 `mbx-req-id` 查找并 `resolve` 对应的 Promise。处理结构化错误。

### 4.2 服务器 (Server)

1. **消息路由**: 根据优先级（Header > Path > Body）提取 `fnId`, `resId`, `act`。
2. **执行与回信**:
   - 将原始 `MailMessage` 注入 `params._req`。
   - 执行工具函数。
   - 向 `mbx-reply-to` 或 `from` 发送响应，并携带相同的 `mbx-req-id`。

## 4. 与 tool-event (Pub/Sub) 的集成思路

Mailbox 传输层天然适合支持 `tool-event` 的数据平面：

- **无连接状态**: 不同于 SSE 需要维持 HTTP 长连接，Mailbox 模式下 `EventServer` 只需在事件发生时向订阅者的 `clientAddress` “邮寄”一封信即可。
- **离线能力**: 如果使用了具备持久化能力的 Provider（如邮件或 MQ），客户端甚至可以在重连后收到离线期间的事件。

## 5. 开发建议

- **Provider 选择**: 单元测试和单进程开发优先使用 `MemoryProvider`。分布式部署可选用基于 Redis、MQTT 或自定义协议的 Provider。

## 5. 设计决策与最佳实践 (Design Decisions & Best Practices)

在实现与测试过程中，我们确立了以下核心准则，以确保系统在分布式环境下的健壮性：

### 5.1 Headers 唯一事实来源

**决策**：彻底废弃基于 URL Pathname 和 Body 字段的路由。
**理由**：

- **协议无关**：许多 Provider（如 `mem:`, `mailto:`）不支持路径解析。
- **安全性**：无需解析业务 Payload (Body) 即可在网关层完成路由。
- **确定性**：消除因不同环境路径解析规则微调导致的路由歧义。

### 5.2 启动即清空积压 (Drain on Start)

**机制**：服务端在 `start()` 时会首先执行 `drainBacklog()`。
**理由**：并非所有 Mailbox Provider 都会在 `subscribe()` 时自动推送积压消息。显式拉取确保服务端即便离线期间错过了推送，也能在上线后立即处理所有缓冲信件。

### 5.3 迁徙安全 (Relocation-proof) 的工具开发

**准则**：工具函数 (`func`) 应当避免依赖外部闭包 (Closure) 变量。
**理由**：在 `tool-rpc` 体系中，工具函数可能会被 `toString()` 序列化、导出给客户端或迁移到就近节点运行。依赖闭包会导致函数在重新求值时报 `ReferenceError`。建议使用 `params` 传递状态或通过 `globalThis` 访问全局单例。

### 5.4 响应重定向与 RPC 超时

**注意**：利用 `mbx-reply-to` 可以实现第三方回信，但这对传统的 RPC 抽象（如 `fetch`）是一个挑战。

- **风险**：如果 Client A 重定向响应给 Client B，Client A 的 `fetch` Promise 将会因为等不到回信而触发超时。
- **建议**：在此类解耦场景下，建议使用原生的 `mailbox.post` 发送请求，或者在 Client A 端配置特定的“只发不收”逻辑。

## 6. 优化路线图 (Optimization Roadmap)

- **流式传输支持 (Streaming)**: 借鉴 HTTP 模式，将 `ReadableStream` 拆分为一系列带有序号的 `MailMessage`（利用 `mbx-chunk-id`），在客户端重组以支持异步流。
- **背压与限流 (Backpressure)**: 在 `Pull` 模式下进一步完善并发控制，根据系统负载动态调整 `pullInterval`。
- **离线请求持久化**: 客户端 `pendingRequests` 目前保存在内存中。未来计划引入持久化存储，使得应用重启后能恢复之前的异步等待状态，实现真正的长时离线支持。
- **元数据 (RpcContext) 标准化**: 定义统一的协议无关 `RpcContext` 接口，屏蔽 HTTP 和 Mailbox 的底层差异，使工具函数能以统一方式访问调用者身份。
- **服务发现缓存**: 为工具定义增加版本号或 ETag 校验，仅在服务器工具集变化时才重新下载，优化大规模系统的启动性能。
- **中间件与拦截器 (Middleware/Interceptors)**: 建立统一的拦截机制，允许在路由分发前后注入通用逻辑（如鉴权、自动参数校验、操作审计和日志跟踪），提升系统的可扩展性。
