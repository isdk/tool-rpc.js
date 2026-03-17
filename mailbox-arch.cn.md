# Mailbox/Actor 传输层架构设计 (v2.1)

## 1. 概述 (Overview)

本文档旨在为 `@isdk/tool-rpc` 设计一个全新的、基于 **Mailbox/Actor 模型**的异步消息传输层。

当前 `@isdk/tool-rpc` 默认实现了基于 HTTP 的同步 RPC。为了进一步增强其灵活性和应用场景，我们提议构建一个并行的、以消息队列为核心的异步传输机制。其核心理念是：“**将一切通信视为向某个地址投递一封信**”。

此设计旨在催生一个独立的 `@mboxlabs/mailbox` 库，并作为一种新的传输选项无缝集成到 `@isdk/tool-rpc` 中。它不仅能处理异步的 RPC 调用，还能为其他通信模式（如 `@isdk/tool-event` 的发布/订阅模型）提供统一的底层支持，为构建分布式、事件驱动、甚至具备离线能力的 AI Agent 系统提供坚实基础。

## 2. 核心理念与安全模型

`Mailbox` 模型的核心是将**地址（去哪里）**、**内容（是什么）** 和 **认证（我是谁）** 三个概念进行彻底分离。

- **邮件地址 (MailAddress)**：遵循 [RFC 3986](https://tools.ietf.org/html/rfc3986) 的 URI 规范。它由**协议 (protocol)**、**物理邮箱地址** 和可选的**逻辑地址**组成，格式为 `protocol:user@domain[/逻辑路径]`。
  * **协议 (`protocol:`)**：指明传输媒介（如 `mailto`, `mem`, `redis`, `mqtt`）。它决定了 `Mailbox` 将信件交给哪个 `Provider` 处理。
  * **物理邮箱地址部分 (`user@domain`)**：是消息在物理层面的**路由终点**。它代表一个逻辑上的邮箱或服务实体。在 `Mailbox` 模型中，`user@domain` 在不同协议下应指向同一个逻辑实体（例如 `mem:api@isdk.com` 和 `mailto:api@isdk.com` 物理上都代表 `isdk.com` 的 API 网关）。
  * **逻辑地址 (`/逻辑路径`)**：是可选的，用于在一个物理邮箱地址下挂载多个逻辑服务（如 `/utils/greeter`）。
    * **注意（关键限制）**：底层传输协议对“逻辑路径”的支持程度各不相同。一些协议（如 HTTP）天然支持路径，但许多协议（如传统的 SMTP 或某些简单的消息队列）在物理寻址层面仅能识别到 `user@domain`。
    * **设计权衡**：由于上述兼容性问题，底层 `mailbox` 虽然在地址结构上保留了逻辑路径的支持，但**强烈建议上层协议（如 `tool-rpc`）不要依赖地址中的逻辑路径进行核心业务路由**。
- **认证 (Authentication)**
    “我是谁”的证明。认证信息（如密码、API Key）是**提供者 (Provider) 的私有配置**，在服务启动时从安全的环境（如环境变量、密钥管理器）加载。它与地址分离，由提供者在内部进行管理和使用，对上层业务代码透明。
- **信件 (MailMessage)**
    通信的基本单元。它是一个包含发件人地址 (`from`)、目标地址 (`to`)、消息体 (`body`) 和元数据 (`headers`) 的结构化对象。请求/响应模式通过 `headers` 中的关联 ID (`mbx-reply-to`) 实现。
- **邮箱 (Mailbox)**
    一个全局或局部的消息路由器，它管理所有注册的 `Provider`，并根据地址的协议头，将“信件”分发给对应的 `Provider` 进行处理。
- **提供者 (MailboxProvider)**
    协议的具体实现者，也是**认证信息的安全保管者**。例如，`EmailProvider` 在初始化时会获得用户的 SMTP/IMAP 凭证，并在其 `send` 或 `subscribe` 方法内部使用这些凭证与邮件服务器交互。

### 架构的对称性：对等的“客户端”与“服务端”

值得注意的是，`Mailbox` 模型在本质上是**对等 (Peer-to-Peer)** 的。传统的“客户端/服务端”模式在这里变得模糊。任何一个参与者，只要它需要接收消息——无论是作为提供服务的“服务端”，还是作为等待 RPC 响应的“客户端”——都必须拥有自己的地址 (`MailAddress`) 并通过相应的 `Provider` 监听该地址。

因此，`tool-rpc` 的 `MailboxClientTransport` 实例在发起请求的同时，其内部也扮演着“微型服务端”的角色，因为它需要监听自己的回复地址以接收响应。这种对称性是 `Mailbox` 架构的核心特征之一，它提供了极大的灵活性，使得构建复杂的、双向通信的分布式系统成为可能。

## 3. 架构组件

### 3.1. `@mboxlabs/mailbox` 库

#### 3.1.0. 设计抉择：实例 vs. 静态

在设计 `Mailbox` 的核心 API 时，一个关键的抉择是：`providers` 注册表应该是全局共享的静态成员，还是每个 `Mailbox` 对象独有的实例成员？

虽然全局静态模式（单例模式）在表面上看起来更简单（无需实例化，全局可访问），但我们最终选择了**基于实例的设计**。这是一个经过深思熟虑的、将为库带来长期健壮性和灵活性的决定。其核心理由如下：

1. **支持多配置的刚性需求**: 这是最关键的理由。在多租户、A/B测试或分环境部署等真实场景中，我们必须能够为同一个通信协议（如 `mailto`）同时使用多套不同的配置（如不同的 API Key）。基于实例的设计允许我们为每个场景创建一个独立配置的 `Mailbox` 实例，而静态设计则无法满足这一硬性需求。
2. **保证架构的整洁与安全**: 通过为不同业务领域（如订单、营销）提供独立的 `Mailbox` 实例，我们能在架构层面强制实现**关注点分离**。这并非核心安全防线，但它是一种强大的**防御性设计**，能从根本上杜绝因代码缺陷或误解导致的跨领域调用风险，从而提升系统的健壮性和可维护性。
3. **遵循灵活的“积木”哲学**: 作为一个通用库，`Mailbox` 的职责是提供一个灵活的“积木”（可实例化的类），而不是强制一个固定的架构模式。应用开发者可以自由选择是用这个“积木”在自己的代码中搭建一个全局单例，还是搭建多个独立实例。

我们也曾探讨过通过设计更复杂的“上下文感知 Provider”来规避创建多实例的方案，但最终认为该方案会将不必要的复杂度引入库的核心，造成抽象泄漏和维护困难，得不偿失。

基于以上理由，我们确信，基于实例的 `Mailbox` 是唯一正确的设计方向。

#### 3.1.1. 核心接口与消息处理模型

`Mailbox` 的核心在于其灵活的消息处理机制。它同时支持**订阅 (Push)** 和**拉取 (Pull)** 两种模式，并内置了清晰的**确认 (ACK/NACK)** 与**错误处理**逻辑。

#### 扩展性与元数据 (Metadata)

`MailMessage` 支持通过 `headers` 携带元数据。底层 `mailbox` 库不对 headers 的内容进行限制，这允许上层协议（如 `tool-rpc` 或 `tool-event`）根据自身需求定义特定的路由、追踪或控制指令。

```ts
/**
 * 代表一个活跃的订阅会话。
 * (内容无变化)
 */
export interface Subscription {
  readonly id: string;
  readonly address: URL;
  readonly status: 'active' | 'connecting' | 'paused' | 'closed';
  unsubscribe(): Promise<void>;
}

/**
 * 代表一封待发送的信件。
 * 这是用户在调用 post() 方法时需要构建的对象。
 */
export interface OutgoingMail {
  /**
   * 消息的物理唯一标识。如果未提供，Mailbox 将自动生成。
   *
   * 建议与消息内容绑定（如使用内容的 Hash），以便实现【内容级幂等】。
   * 邮箱系统通过此 ID 识别并丢弃内容重复的信件，确保同一份信息不会被物理重复投递。
   */
  id?: string;
  from: URL | string;
  to: URL | string;
  body: any;
  /**
   * Mailbox 框架及其生态约定的控制信息（控制平面），用于指导消息的传输、路由、认证和关联。
   *
   * 标准 Header 约定：
   * - `req-id`: 请求标识 (Request ID)。用于在异步交互中匹配请求与响应。
   *   在运输层，它作为单次交互的关联键，同时用于处理网络重传导致的【请求级去重】。
   *   每次请求应生成独立的 req-id 以确保当前闭环。
   * - `trace-id`: 全链路追踪标识 (Trace ID)。由业务源头生成并在整个生命周期中透传。
   *   用于跨多个 Request 串联起完整的业务流日志，是解决分布式复杂拓扑下可观测性问题的关键。
   * - `mbx-reply-to`: 邮箱系统标准的回复地址。指明响应消息应发往的 Mailbox 地址。
   * - `mbx-sent-at`: 发送时间戳 (ISO 8601)。由 Provider 在发送时自动注入。
   *   代表消息正式进入传输系统的时刻，是审计消息时效、监控传输延迟的权威标准。
   */
  headers?: { [key: string]: any; };
  /**
   * 本邮件消息的附加数据（邮件的数据平面），是消息的业务内容的补充元信息，由业务应用自定义和使用。
   * 系统只负责透传，不进行解析和干预。本质上是邮件的一部分。
   */
  meta?: { [key: string]: any; };
}

/**
 * 代表一封在系统内传递的、带有唯一标识的规范信件。
 * 这是在 Mailbox 与 Provider 之间传递的主要对象。
 * 消费者收到的也是此类型的消息。
 */
export interface MailMessage extends OutgoingMail {
  readonly id: string;
  readonly from: URL;
  readonly to: URL;
}

/**
 * 定义了所有具体通信方式必须实现的接口。
 * Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。
 */
export interface IMailboxProvider {
  protocol: string;
  /**
   * Provider 实际监听的物理网关地址。
   * 这是消息传输的入口点，例如 'api@example.com'。它在 Provider 构造时根据其配置确定。
   */
  readonly listenAddress: URL;
  /**
   * Provider 负责提供服务的逻辑地址模式列表。
   * 例如，一个 Provider 可能监听在 `internal-gateway@infra.net`，但声明自己服务于 `*@myservice.com` 和 `admin@legacy.com`。
   * 这允许一个物理端点为多个逻辑用户或域提供服务，实现了物理传输层与逻辑服务层的解耦。
   * 模式可以包含通配符 `*` 来匹配任意用户部分或域部分。
   */
  readonly servedAddressPatterns: string[];

  /**
   * 生成一个全局唯一的信件 ID。
   * 如果 OutgoingMail 中未提供 ID，Mailbox 将调用此方法生成。
   * 建议实现为基于消息内容的 Hash，以支持内容级幂等。
   */
  generateId(message: OutgoingMail): string;

  /**
   * 初始化 Provider。用于建立连接、验证配置等。
   */
  init?(): Promise<void>;

  /**
   * 关闭 Provider。用于释放资源、断开连接等。
   */
  close?(): Promise<void>;

  send(message: MailMessage): Promise<MailMessage>;

  /**
   * 【订阅模式】订阅一个地址，当有信件到达时触发回调。
   * 确认机制为隐式ACK：当 onReceive 函数成功执行，消息被自动确认。
   * 发生异常时，将根据错误类型决定是重试还是移入死信队列。
   */
  subscribe(address: URL, onReceive: (message: MailMessage) => void | Promise<void>): Subscription;

  /**
   * 【拉取模式】从指定地址主动拉取一封信件。
   * 支持自动ACK (默认) 和手动ACK两种模式。
   */
  fetch(address: URL, options: { manualAck: true }): Promise<AckableMailMessage | null>;
  fetch(address: URL, options?: { manualAck?: false }): Promise<MailMessage | null>;
  fetch(address: URL, options?: { manualAck?: boolean }): Promise<MailMessage | AckableMailMessage | null>;

  /**
   * [新增] 查询指定地址的状态。
   * 这是一个可选实现的方法。如果 Provider 不支持，可以抛出 "Not Implemented" 错误或返回一个默认状态。
   * @param address 要查询状态的地址。
   * @returns 返回地址的状态信息。
   */
  status?(address: URL): Promise<MailboxStatus>;
}
```

##### **消息确认与手动 ACK 流程**

为了在 `fetch` 模式下实现精确的控制，我们引入了 `AckableMailMessage` 的概念。

```typescript
// @mboxlabs/mailbox/src/interfaces.ts (续)

/**
 * 代表一个可被手动确认或拒绝的信件。
 */
export interface Ackable {
  /**
   * 确认消息已被成功处理。
   * Provider 将会通知消息队列彻底删除此消息。
   */
  ack(): Promise<void>;

  /**
   * 拒绝消息。
   * @param requeue 如果为 true，请求消息队列将此消息重新放回，使其可以被再次消费。
   *                如果为 false，消息将被丢弃或移入死信队列。
   */
  nack(requeue?: boolean): Promise<void>;
}

export type AckableMailMessage = MailMessage & Ackable;
```

当消费者调用 `fetch` 并设置 `manualAck: true` 时，`Provider` 会返回一个 `AckableMailMessage`。消费者在完成业务逻辑后，必须调用 `ack()` 或 `nack()` 方法来显式地结束消息生命周期。`Provider` 负责将这两个方法与底层消息队列（如 RabbitMQ, SQS）的确认机制进行绑定。

##### **邮箱状态查询**

为了增强系统的可观测性，我们引入了 `status` 查询机制。

```typescript
// @mboxlabs/mailbox/src/interfaces.ts (续)

/**
 * 代表一个邮箱地址的状态信息。
 */
export interface MailboxStatus {
  /**
   * 提供者自身的连接或运行状态。
   */
  state: 'online' | 'offline' | 'degraded' | 'unknown';
  /**
   * 队列中未被消费的消息数量。
   */
  unreadCount?: number;
  /**
   * 最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)。
   */
  lastActivityTime?: string;
  /**
   * 可选的附加状态信息或错误消息。
   */
  message?: string;

  /**
   * 索引签名，允许 MailboxStatus 包含任意其他字符串键的属性。
   * 这些属性将作为提供者特定的扩展信息。
   */
  [key: string]: any;
}
```

##### **最终的错误处理与重试策略**

一个健壮的系统需要一套清晰、灵活且可扩展的错误处理机制。

**决策优先级**

`Provider` 在捕获到错误后，会按以下优先级来判断是否应该重试：

1. **最高优先级：`isRetriable` 标识**。任何错误对象，无论其类型，只要带有一个值为 `true` 的 `isRetriable` 属性，就会被认为是可重试的。这为集成第三方库提供了极大的便利。
2. **第二优先级：错误 `code` 策略**。如果错误没有 `isRetriable` 标识，但如果有`code`属性，那么 `Provider` 将根据其内部的可配置策略来判断 `code` 是否可重试（例如，`503`, `504` 可重试，而 `4xx` 和 `500` 不可重试）。
3. **默认行为**：以上条件都不满足的错误，一律被视为**不可重试**。

**`Provider` 的决策逻辑**

```typescript
// 伪代码: Provider 的最终决策函数
function isErrorRetriable(error: any): boolean {
  if (error) {
    // 优先级 1: 检查通用重试标识
    if (error.isRetriable === true) return true;
    // 优先级 2: 检查 错误码
    if (error.code) return [503, 504].includes(error.code);
  }
  // 默认：不可重试
  return false;
}
```

**不可重试错误的处理流程**

对于不可重试的错误，`Provider` 的行为必须以**保证消息不被重复处理**为最高优先级。因此，处理顺序至关重要：

1. **优先最终处理**：`Provider` **必须**首先对消息执行 `nack(false)`，以确保它被永久地从队列中移除。此步骤之后，可以安全地将消息归档到“死信队列”(DLQ) 中。
2. **再尝试回复**：完成 `nack` 后，`Provider` 再尽力（best-effort）尝试向调用方回复一个错误响应（如果消息是 RPC 请求）。

这个“先处理，后回复”的顺序是更健壮的设计。它能保证有问题的消息绝对不会被重复处理，代价是如果回复步骤失败，客户端将收不到明确的错误原因，而是会触发自身的超时逻辑——这通常是客户端必须具备的容错能力。

#### 3.1.2. 抽象基类：`MailboxProvider` (为简化开发)

为了统一 `Provider` 的行为、减少样板代码并降低开发新 `Provider` 的复杂度，我们引入了一个抽象基类 `MailboxProvider`。该基类采用了**模板方法模式 (Template Method Pattern)**，定义了 `Provider` 的核心工作流程，同时将特定于协议的实现细节延迟到子类中完成。

`MailboxProvider` 的核心职责包括：

- **自动注入时间戳**：在 `send` 方法中自动添加 `mbx-sent-at` 头部。
- **订阅生命周期管理**：统一处理 `Subscription` 对象的创建、追踪和销毁。
- **集中的错误处理**：为 `subscribe` 的回调提供 `try...catch` 包装，实现隐式 ACK 和统一的错误处理逻辑。
- **提供默认实现**：为 `status` 等可选方法提供默认行为。

具体的 `Provider` (如 `MemoryProvider`, `EmailProvider`) 只需继承 `MailboxProvider` 并实现一组简单的 `protected` 抽象方法 (`_send`, `_subscribe`, `_fetch` 等)，即可获得所有通用能力。

##### **内部订阅管理**

`MailboxProvider` 内部使用 `ManagedSubscription` 接口来追踪每个订阅的状态。

```typescript
/**
 * 代表一个由 MailboxProvider 内部管理的订阅记录。
 * 它持有管理订阅生命周期所需的所有数据。
 */
interface ManagedSubscription {
  id: string;
  address: URL;
  wrappedOnReceive: (message: MailMessage) => void | Promise<void>;
  // 持有由具体 Provider 的 _subscribe 方法返回的底层句柄，
  // 用于取消订阅。
  unsubscribeHandle?: any;
}
```

> **重要提示**：`ManagedSubscription` 是 `MailboxProvider` 内部使用的数据结构。如果未来需要修改公共的 `Subscription` 接口，请务必同步检查并更新此内部接口以保持一致性。

##### **示例：简化后的 `MemoryProvider`**

通过继承 `MailboxProvider`，`MemoryProvider` 的代码变得极为简洁，因为它只用关心核心的内存消息读写逻辑。

```typescript
// @mboxlabs/mailbox/src/providers/memory.ts (重构后)
import { MailboxProvider } from './MailboxProvider';
// ... 其他 imports

// MemoryEventBus 保持不变

export class MemoryProvider extends MailboxProvider {
  private bus = MemoryEventBus.getInstance();

  constructor() {
    super('mem');
  }

  protected async _send(message: MailMessage): Promise<void> {
    const topic = getTopic(message.to);
    this.bus.publish(topic, message);
  }

  protected _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => Promise<void>,
  ): any {
    const topic = getTopic(address);
    // 返回的 unsubscribe 函数将作为 unsubscribeHandle
    return this.bus.subscribe(topic, onReceive);
  }

  protected async _unsubscribe(
    subscriptionId: string,
    unsubscribeHandle: any,
  ): Promise<void> {
    if (typeof unsubscribeHandle === 'function') {
      unsubscribeHandle();
    }
  }

  // _fetch, _status, _ack, _nack 的实现也同样被简化...
}
```

#### 3.1.3. `Mailbox` 中心路由

`Mailbox` 的 `subscribe` 方法现在返回一个 `Subscription` 对象，以提供更丰富的管理能力。

```typescript
// @mboxlabs/mailbox/src/mailbox.ts
import { IMailboxProvider, MailMessage, OutgoingMail, Subscription } from './interfaces';

export class Mailbox {
  private providers: Map<string, IMailboxProvider> = new Map();

  /**
   * 启动所有注册的 Provider。
   * 建议在应用初始化阶段调用此方法，以确保所有通信通道准备就绪。
   */
  public async start(): Promise<void> {
    const providers = Array.from(this.providers.values());
    await Promise.all(providers.map(p => p.init?.()));
  }

  /**
   * 关闭所有注册的 Provider，并释放资源。
   * 建议在应用关闭阶段调用此方法。
   */
  public async stop(): Promise<void> {
    const providers = Array.from(this.providers.values());
    await Promise.all(providers.map(p => p.close?.()));
  }

  public registerProvider(provider: IMailboxProvider): void {
    this.providers.set(provider.protocol, provider);
  }

  public async post(mail: OutgoingMail): Promise<MailMessage> {
    const toUrl = new URL(mail.to);
    const fromUrl = new URL(mail.from);
    const provider = this.providers.get(toUrl.protocol.slice(0, -1));
    if (!provider) throw new Error(`No provider for protocol: ${toUrl.protocol}`);

    const message: MailMessage = {
      id: mail.id ?? provider.generateId(mail),
      from: fromUrl,
      to: toUrl,
      body: mail.body,
      headers: mail.headers || {},
      meta: mail.meta || {},
    };

    await provider.send(message);
    return message;
  }

  public subscribe(address: string | URL, onReceive: (message: MailMessage) => void): Subscription {
    const addrUrl = new URL(address);
    const provider = this.providers.get(addrUrl.protocol.slice(0, -1));
    if (!provider) throw new Error(`No provider for protocol: ${addrUrl.protocol}`);

    return provider.subscribe(addrUrl, onReceive);
  }

  public async fetch(address: string | URL, options: { manualAck: true }): Promise<AckableMailMessage | null>;
  public async fetch(address: string | URL, options?: { manualAck?: false }): Promise<MailMessage | null>;
  public async fetch(address: string | URL, options?: { manualAck?: boolean }): Promise<MailMessage | AckableMailMessage | null> {
    const addrUrl = new URL(address);
    const provider = this.providers.get(addrUrl.protocol.slice(0, -1));
    if (!provider) throw new Error(`No provider for protocol: ${addrUrl.protocol}`);

    return provider.fetch(addrUrl, options);
  }

  /**
   * 查询指定地址的状态信息。
   * @param address 要查询的地址。
   * @returns 返回该地址的邮箱状态。
   */
  public async status(address: string | URL): Promise<MailboxStatus> {
    const addrUrl = new URL(address);
    const provider = this.providers.get(addrUrl.protocol.slice(0, -1));
    if (!provider) {
      throw new Error(`No provider for protocol: ${addrUrl.protocol}`);
    }

    if (!provider.status) {
      // 如果 Provider 没有实现 status 方法，返回一个默认的未知状态。
      return {
        state: 'unknown',
        message: `The '${provider.protocol}' provider does not support status queries.`
      };
    }

    return provider.status(addrUrl);
  }
}
```

#### 3.1.4. 提供者的“智能适配器”角色 (Provider as Smart Adapter)

`Mailbox` 架构的一个核心优势在于其对不同通信协议的抽象能力。然而，并非所有协议都能原生支持 `MailMessage` 的完整结构，特别是 `headers`（控制平面）和 `meta`（数据平面）的分离。

以标准的电子邮件协议（SMTP/IMAP）为例，它并没有一个可靠传递自定义元数据的“标准头部”区域。在这种情况下，`Provider` 必须扮演**智能适配器 (Smart Adapter)** 的角色，将一个规范的 `MailMessage` 对象无损地编码到底层协议中。

**示例：`EmailProvider` 的附件编码策略**

一个更贴近邮件协议习惯的策略是将控制/元数据打包成一个专门的附件，而不是污染邮件正文。

当 `EmailProvider` 发送一封邮件时，它会执行以下编码过程：

* **原始 `MailMessage`**:

  ```json
  {
    "to": "mailto:api@service.com/toolA",
    "from": "mailto:user@client.com",
    "headers": { "mbx-reply-to": "req-123" },
    "meta": { "subject": "Run Tool A" },
    "body": "This is the main content for the tool."
  }
  ```

* **`EmailProvider` 编码后的电子邮件结构**:
  * **To**: `api@service.com` (从 `to` 地址中提取)
  * **From**: `user@client.com` (从 `from` 地址中提取)
  * **Subject**: `Run Tool A` (从 `meta.subject` 中提取)
  * **Body**: `This is the main content for the tool.` (直接使用原始 `body`)
  * **Attachment**:
    * **Filename**: `mailbox-metadata.json`
    * **MIME Type**: `application/mbx+json`
    * **Content** (JSON 格式):

    ```json
    {
      "to": "mailto:api@service.com/toolA",
      "from": "mailto:user@client.com",
      "headers": { "mbx-reply-to": "req-123" },
      "meta": { "subject": "Run Tool A" }
    }
    ```

当 `EmailProvider` 通过 IMAP 接收到这样一封邮件时，它会执行相反的解码过程：

1. **查找附件**：检查邮件是否包含 MIME 类型为 `application/mbx+json` 的附件。
2. **解析附件**：如果找到，则解析其 JSON 内容。
3. **重构 `MailMessage`**：从附件中提取 `to`, `from`, `headers`, `meta`，并结合邮件的主体（Body）和主题（Subject，可放入 `meta`），重新构建出原始的、规范的 `MailMessage` 对象。
4. **传递消息**：将重构后的 `MailMessage` 传递给 `Mailbox` 的订阅者。

通过这种方式，`Provider` 作为一个“智能适配器”，确保了即使在功能受限的传输协议上，`Mailbox` 架构的核心概念（如控制平面与数据平面的分离）依然能够被完整、可靠地实现。这种策略对上层应用是完全透明的。

#### 3.1.5. 生命周期管理 (Lifecycle Management)

为了支持复杂的分布式场景（如管理数据库连接、消息队列长连接等），`Mailbox` 引入了显式的生命周期管理机制：

- **`mailbox.start()`**: 遍历所有已注册的 Provider 并调用其 `init()` 方法。这是预热连接、验证 API Key 和网络配置的最佳时机。
- **`mailbox.stop()`**: 遍历所有已注册的 Provider 并调用其 `close()` 方法。
  - **自动清理**：`MailboxProvider` 基类保证在 `close()` 时会自动取消该 Provider 下的所有活跃订阅，防止内存泄漏和关闭过程中的意外回调。
  - **优雅退出**：确保所有底层资源（如 TCP 连接、文件句柄）被正确释放。

在生产环境中，建议在应用启动脚本中包含 `await mailbox.start()`，并在进程退出（如监听 `SIGTERM`）时执行 `await mailbox.stop()`。

#### 3.1.6. 提供者配置与安全 (示例)

这部分演示了如何在 `Provider` 初始化时安全地注入凭证并进行生命周期管理。

```typescript
// --- A. 在安全的环境中定义配置 (e.g., .env) ---
// MY_EMAIL_SMTP_PASSWORD=...
// MY_EMAIL_IMAP_PASSWORD=...

// --- B. 在应用启动时，安全地初始化 Provider ---
import { EmailProvider } from './providers/email'; // 假设的 EmailProvider
import { Mailbox } from './mailbox';

// 安全地加载配置
const myEmailAuthConfig = {
  address: 'me@example.com',
  smtp: {
    host: 'smtp.example.com',
    auth: { user: 'me@example.com', pass: process.env.MY_EMAIL_SMTP_PASSWORD },
  },
  imap: {
    host: 'imap.example.com',
    auth: { user: 'me@example.com', pass: process.env.MY_EMAIL_IMAP_PASSWORD },
  },
};

// 初始化 Provider，凭证被安全地保存在实例内部
const emailProvider = new EmailProvider([myEmailAuthConfig]); // 可以管理多个账户

// --- C. 注册 Provider 并启动 ---
const mailbox = new Mailbox();
mailbox.registerProvider(emailProvider);

// 关键：启动所有已注册的 Provider
await mailbox.start();

// `mailbox` 实例现在已经准备就绪。
// 在应用关闭时：
// await mailbox.stop();
```

## [4. 与 `@isdk/tool-rpc` 的集成：网关模式与服务发现](./mailbox-tool-rpc-integration.md)
