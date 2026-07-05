[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcTransportManager

# Class: RpcTransportManager

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:12](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L12)

RPC 传输管理器 - 负责传输实例的生命周期、地址映射与策略校验

## Constructors

### Constructor

> **new RpcTransportManager**(): `RpcTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:27](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L27)

#### Returns

`RpcTransportManager`

## Accessors

### instance

#### Get Signature

> **get** `static` **instance**(): `RpcTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:32](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L32)

获取全局单例

##### Returns

`RpcTransportManager`

## Methods

### addRestrictedPattern()

> **addRestrictedPattern**(`pattern`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:215](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L215)

动态添加受限模式

#### Parameters

##### pattern

`RestrictedPattern` \| `RestrictedPattern`[]

#### Returns

`void`

***

### addServer()

> **addServer**(`transport`, `apiUrl?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:140](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L140)

注册并管理服务端传输实例。
会执行物理地址与逻辑路由的冲突审计。

#### Parameters

##### transport

[`IServerToolTransport`](../interfaces/IServerToolTransport.md)

##### apiUrl?

`string`

#### Returns

`void`

***

### getClient()

> **getClient**(`apiUrl`, `options?`): [`IClientToolTransport`](../interfaces/IClientToolTransport.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:96](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L96)

获取或创建客户端传输实例

#### Parameters

##### apiUrl

`string`

##### options?

`any`

#### Returns

[`IClientToolTransport`](../interfaces/IClientToolTransport.md)

***

### register()

> **register**(`transport`, `apiUrl?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:83](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L83)

注册已有的传输实例

#### Parameters

##### transport

[`IToolTransport`](../interfaces/IToolTransport.md)

##### apiUrl?

`string`

#### Returns

`void`

***

### startAll()

> **startAll**(`options?`): `Promise`\<`any`[]\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:168](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L168)

启动所有托管的服务端传输实例

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`[]\>

***

### stopAll()

> **stopAll**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:176](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L176)

停止所有托管的传输实例 (包括客户端连接池回收与服务端监听关闭)

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

***

### validateRpcRequest()

> **validateRpcRequest**(`request`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:203](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L203)

架构级策略校验 - 在请求进入调度器前执行
默认执行 SSRF 防御校验。可通过继承并重写此方法来扩展自定义策略。

#### Parameters

##### request

[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)

归一化的 RPC 请求对象

#### Returns

`void`

***

### bindScheme()

> `static` **bindScheme**(`schemes`, `transportClass?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:45](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L45)

绑定 URL Scheme 到具体的传输实现类

#### Parameters

##### schemes

`string` \| `string`[] \| ((`scheme`) => `any`)

单个或多个 Scheme (如 'http', 'wechat')，或动态解析器函数

##### transportClass?

`any`

当 schemes 为字符串或数组时对应的实现类

#### Returns

`void`

***

### clearSchemes()

> `static` **clearSchemes**(`scheme?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:70](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L70)

清空所有静态注册的 Schemes (主要用于测试清理)

#### Parameters

##### scheme?

`string`

可选，仅清除指定 scheme

#### Returns

`void`

***

### ~~registerProtocol()~~

> `static` **registerProtocol**(`scheme`, `transportClass`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/manager.ts:62](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/manager.ts#L62)

#### Parameters

##### scheme

`string`

##### transportClass

`any`

#### Returns

`void`

#### Deprecated

使用 bindScheme 代替
