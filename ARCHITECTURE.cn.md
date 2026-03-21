# @isdk/tool-rpc 底层架构深度解析

本文档旨在详尽记录 `@isdk/tool-rpc` 的底层设计哲学、核心实现机制以及关于隔离与安全的深度思考。

## 1. 设计哲学：静态管理与实例执行的解耦

`@isdk/tool-rpc` 建立在 `@isdk/tool-func` 之上，其最核心的架构决策是利用 JavaScript 的原型链特性来实现**静态管理层（Registry）**与**实例执行层（Function）**的物理分离。

### 1.1 静态类作为容器 (Plural 'Tools')

类对象（如 `ServerTools`）不仅是实例的模板，它本身也是一个全局单例容器。

- **注册表 (`items`)**：通过在类上挂载静态 `items` 属性，实现了工具定义的中心化存储。
- **发现协议 (`toJSON`)**：静态方法 `toJSON` 承担了“海选”职责，它决定了在特定的传输层挂载点下，哪些工具是可见的。

### 1.2 实例作为业务函数 (Singular 'Tool'/'Func')

通过 `new` 关键字创建的每个实例都是一个具体的执行单元。

- **上下文绑定**：实例方法（如 `func`）通过 `this` 访问元数据，通过 `this.ctx` 访问运行时上下文（如 `AbortSignal`, `request` 对象）。
- **影子实例 (Shadow Instance)**：利用原型继承，为每次请求创建临时的影子实例，确保并发请求下的状态隔离。

### 1.3 寻址与协议解耦 (V2 Addressing)

在重构后的 V2 架构中，业务逻辑与物理传输协议通过 **`apiUrl`** 彻底解耦。

- **逻辑寻址标识**：不再依赖全局唯一的 Transport 实例，而是通过 URL（如 `http://srv/v1` 或 `mailbox://peer-1/api`）进行逻辑匹配。
- **协议透明化**：`ClientTools` 类持有 `apiUrl` 后，底层 `RpcTransportManager` 会根据 URL 的 Scheme 自动调度正确的物理传输层。

## 2. 核心机制解析

### 2.1 发现隔离算法 (Discovery Filtering)

这是实现分层抽象（Server -> RPC -> Resource）的关键。其伪代码逻辑如下：

```typescript
static toJSON() {
  return filter(this.items, (item) => {
    // 1. 类型约束：必须是当前类或子类的实例
    const isInstanceOf = item instanceof this;

    // 2. 协议边界检查：子类若重写了发现逻辑，则父类不再导出它
    const isSameProtocol = item.constructor.toJSON === this.toJSON;

    // 3. 显式开关
    const isNotHidden = item.isApi !== false;

    return isInstanceOf && isSameProtocol && isNotHidden;
  });
}
```

**设计意图**：

- **向上隔离**：调用 `ResServerTools.toJSON()` 时，`instanceof` 会自动过滤掉父级 `RpcMethodsServerTool` 的通用实例。
- **向下隔离**：当子类为了支持更复杂的 REST 语义而演进出不同的 `toJSON` 逻辑时，父类 `ServerTools` 通过引用检查 (`=== this.toJSON`) 自动将其排除，防止基础客户端尝试调用它无法理解的复杂 API。

### 2.2 静态继承与物理隔离 (Property Shadowing)

在单进程（如 Vitest 测试）中，若不加干预，所有 Tools 子类都会通过原型链共享 `ToolFunc.items`。

**隔离原理**：
当我们调用 `ClientTools.isolateRegistry()` 时，系统会通过 JavaScript 原型链机制为当前类构建一个全新的**分层注册表上下文 (Hierarchical Registry Context)**。这不仅包括对 `items`（工具集）的隔离，还涵盖了对 `aliases`（别名表）及 `refCounts`（引用计数）的深度隔离：

1. **属性遮蔽**：在 `ClientTools` 构造函数对象上直接创建独立的 `items`、`aliases` 及 `refCounts` 属性引用。
2. **写时隔离**：后续在 `ClientTools` 作用域内的注册（`register`）操作将仅写入这些局部属性，而不会触碰父类的全局状态。
3. **读时继承**：这种隔离通过 `Object.create(parent.items)` 等机制保持了对父级已有工具的只读回溯，实现了真正的“继承式隔离”。

## 2.3 分层注册表与多态动态绑定

`@isdk/tool-rpc` 的核心架构之一是支持**分层注册表 (Hierarchical Registries)**。这一特性利用 JavaScript 的原型链 (`__proto__`) 实现了工具的隔离、继承与多态遮蔽，为多租户和插件系统提供了天然的底层支持。

### 2.3.1 原型链遮蔽 (Shadowing)

当执行 `isolateRegistry()` 时，系统底层会为当前注册表构建多维度的层级上下文。

- **多维度隔离**：隔离的范围包括核心的 `items`，以及用于快速检索的 `aliases` 和维护生命周期的 `refCounts`。
- **逻辑闭环**：读操作由于原型链存在可自动回溯，而写操作产生影子（Shadowing）。这种分层逻辑也支持了“作用域注销 (Scoped Unregistration)”，确保注销影子后，父级工具能重新变为可见。

### 2.3.2 智能绑定策略 (`binding` 模式)

在处理工具间的 `depends` 依赖项时，系统必须决定是使用“定义时确定的原始依赖”还是“运行时上下文覆盖后的多态依赖”。这是业务灵活性与稳定性的分水岭。

#### 1. `'auto'` (智能血缘感知) - 推荐模式

- **算法核心**：通过检查“当前根调用者 (rootRegistry)”是否为该工具“定义者 (definingRegistry)”的后代作用域。
- **判定逻辑**：若 `rootRegistry` 位于 `definingRegistry` 的原型链下游，则尝试寻找影子遮蔽版本。
- **架构意义**：它完美解决了“插件定制”与“核心稳定性”的矛盾。插件可以放心地修改工作流中的某个原子工具，而父类在独立运行其自身逻辑时，依然能够获得其注册时约定的确定性依赖，不会被外部影子干扰。

#### 2. `'early'` (早绑定) - 确定性优先

- **实现**：在工具实例化或注册时，强行绑定依赖项的引用，后续不进行任何运行时查找。
- **场景**：用于关键的安全路径、审计追踪或核心组件，这些组件的契约必须跨层级保持严格一致。

#### 3. `'late'` (晚绑定) - 环境感知优先

- **实现**：无视层级亲疏，每次调用时均从当前执行环境的最顶层注册表重新解析依赖名称。
- **场景**：高度动态的环境注入，例如根据当前的租户 ID 彻底切换底层存储或通知中间件。

## 3. 逻辑分层与分发机制

### 3.1 抽象层级

1. **基础层 (ServerTools)**：单点对单点。`func` 即业务。
2. **服务层 (RpcMethodsServerTool)**：引入 `$方法`。`func` 演化为**分发器 (Dispatcher)**，根据 `params.act` 派发任务。
3. **资源层 (ResServerTools)**：引入 REST 语义。分发逻辑进一步增强，根据 HTTP Method 和 `id` 自动映射到 `get/list/post` 等方法。

### 3.2 影子实例与执行流

在 `handleRpcRequest` 中，系统并不直接运行注册表中的原始实例，而是：

1. 调用 `func.with(ctx)`。
2. `with` 方法内部执行 `Object.create(this)`。
3. 将请求特定的 `_req`, `_res`, `_signal` 注入到这个影子实例中。
4. **意义**：这实现了“逻辑共享，状态隔离”，是支持高并发 RPC 调用的核心保证。

## 4. 安全性思考

### 4.1 隐藏 vs. 禁用 (The Visibility Gap)

`isApi: false` 在本架构中定义为**可见性标记**而非**硬性访问权限**。

- **理由**：`tool-rpc` 专注于通信能力的连通。
- **隐患**：如果传输层未显式校验 `isApi !== false`，则存在“隐蔽路径访问”风险。
- **架构建议**：安全性应作为独立的拦截器（Middleware）或切面（Aspect）存在，通过读取实例的元数据（如自定义权限标签）来决定是否允许执行。

### 4.2 包内可见性

这种设计允许在同一个进程内注册大量的辅助工具（Helper Tools），它们对远程客户端不可见（`isApi: false`），但可以被其它远程工具通过 `this.runAs('helper')` 内部调用，实现了类似编程语言中 `private` 或 `internal` 的访问级别。

## 5. 常见架构挑战

### 5.1 循环依赖

由于工具可以通过名称互相发现，静态注册顺序至关重要。框架通过 `depends` 属性支持声明式依赖，并在注册时自动处理依赖项的注册。

### 5.2 多版本共存

在复杂的 Monorepo 中，若多个版本的 `@isdk/tool-func` 被打包，`instanceof` 可能会失效。架构上应优先依赖 `name` 和协议标识符，而非单纯的原型检查。

## 6. 分布式寻址与连接模式 (V2 Service Connection)

### 6.1 服务连接模式 (Service Connection Pattern)

为了解决“同一个业务服务类（如 `OrderService`）需要同时对接多种传输协议”的问题，架构引入了 `connect` 工厂模式。

```typescript
class OrderService extends ClientTools {}

// 1. 业务定义与物理寻址解耦
const httpApi = OrderService.connect('http://localhost/api');
const mbxApi = OrderService.connect('mailbox://peer-1/api');

// 2. 独立的 Stub 隔离加载
await httpApi.loadFrom();
await mbxApi.loadFrom();

// 3. 执行时自动匹配正确的 Transport
await httpApi.createOrder.run({ id: 1 });
await mbxApi.createOrder.run({ id: 2 });
```

### 6.2 动态绑定调用 (On-demand Binding)

对于极致灵活的场景（如路由网关或多区域调度），架构支持在执行瞬间动态指定目标。利用 `with` 机制在“影子实例”中注入寻址信息。

```typescript
// 1. 获取通用工具存根 (Stub)
const chatTool = ClientTools.get('chat');

// 2. 在执行瞬间决定目标集群 (无状态调用)
const resUS = await chatTool.with({ apiUrl: 'https://us.api/v1' }).run({ text: 'Hello' });
const resCN = await chatTool.with({ apiUrl: 'https://cn.api/v1' }).run({ text: '你好' });
```

- **无状态特性**：Stub 本身不持有寻址状态，状态仅存在于单次调用的上下文中。
- **环境感知**：支持根据用户地理位置、负载均衡策略或租户 ID 在运行时动态路由 RPC 请求。

### 6.3 传输管理中心 (RpcTransportManager)

`RpcTransportManager` 是整个 V2 架构的“交通枢纽”。它负责：

- **二级寻址**：根据 `apiUrl` 的 Scheme 路由到具体协议类，再根据 Origin 复用物理连接。
- **配置透传**：通过 `connect(url, options)` 传入的配置，最终会流转到 Transport 实例，支持超时、认证等连接级配置。
- **物理底座共享**：支持多个逻辑 `apiUrl` 共享同一个物理端口（如 HTTP 的不同 Path 挂载）。

### 6.4 联邦寻址 (Federated Addressing)

每一个 `ClientTools` 实例（Stub）手里都握着一份 `apiUrl` 地图。在调用 `run()` 时，它不再依赖全局唯一的 Transport，而是：
1. 从 `this.apiUrl` 获取目标地址。
2. 委托 `RpcTransportManager` 找到该地址对应的 Transport。
3. 执行远程搬运。

这种设计使得应用能够以“联邦化”的方式同时与数十个微服务进行通信，每个服务可以有不同的地址、不同的协议，且相互物理隔离。

