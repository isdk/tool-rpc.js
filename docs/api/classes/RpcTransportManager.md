[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcTransportManager

# Class: RpcTransportManager

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:17](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L17)

RPC 传输管理器（服务端完整版）
继承了 RpcClientTransportManager 的客户端能力，额外增加了服务端生命周期管理、
路由审计和 SSRF 防护。

在 Node.js 环境中使用此类以保持完全的向后兼容。

## Extends

- `RpcClientTransportManager`

## Constructors

### Constructor

> **new RpcTransportManager**(): `RpcTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:29](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L29)

#### Returns

`RpcTransportManager`

#### Overrides

`RpcClientTransportManager.constructor`

## Properties

### transports

> `protected` **transports**: `Map`\<`string`, [`IToolTransport`](../interfaces/IToolTransport.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client-manager.ts:19](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/client-manager.ts#L19)

实例缓存: apiUrl -> Transport Instance

#### Inherited from

`RpcClientTransportManager.transports`

## Accessors

### instance

#### Get Signature

> **get** `static` **instance**(): `RpcTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:36](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L36)

获取全局单例

##### Returns

`RpcTransportManager`

#### Overrides

`RpcClientTransportManager.instance`

## Methods

### addRestrictedPattern()

> **addRestrictedPattern**(`pattern`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:134](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L134)

动态添加受限模式

#### Parameters

##### pattern

`RestrictedPattern` \| `RestrictedPattern`[]

#### Returns

`void`

#### Overrides

`RpcClientTransportManager.addRestrictedPattern`

***

### addServer()

> **addServer**(`transport`, `apiUrl?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:60](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L60)

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client-manager.ts:87](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/client-manager.ts#L87)

获取或创建客户端传输实例

#### Parameters

##### apiUrl

`string`

##### options?

`any`

#### Returns

[`IClientToolTransport`](../interfaces/IClientToolTransport.md)

#### Inherited from

`RpcClientTransportManager.getClient`

***

### register()

> **register**(`transport`, `apiUrl?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:46](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L46)

注册已有的传输实例（服务端版：额外识别并管理服务端实例）

#### Parameters

##### transport

[`IToolTransport`](../interfaces/IToolTransport.md)

##### apiUrl?

`string`

#### Returns

`void`

#### Overrides

`RpcClientTransportManager.register`

***

### startAll()

> **startAll**(`options?`): `Promise`\<`any`[]\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:106](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L106)

启动所有托管的服务端传输实例

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`[]\>

***

### stopAll()

> **stopAll**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:114](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L114)

停止所有托管的传输实例 (包括客户端连接池回收与服务端监听关闭)

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Overrides

`RpcClientTransportManager.stopAll`

***

### validateRpcRequest()

> **validateRpcRequest**(`request`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server-manager.ts:149](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server-manager.ts#L149)

架构级策略校验 - 在请求进入调度器前执行
默认执行 SSRF 防御校验。可通过继承并重写此方法来扩展自定义策略。

#### Parameters

##### request

[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)

归一化的 RPC 请求对象

#### Returns

`void`

#### Overrides

`RpcClientTransportManager.validateRpcRequest`

***

### bindScheme()

> `static` **bindScheme**(`schemes`, `transportClass?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client-manager.ts:39](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/client-manager.ts#L39)

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

#### Inherited from

`RpcClientTransportManager.bindScheme`

***

### clearSchemes()

> `static` **clearSchemes**(`scheme?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client-manager.ts:64](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/client-manager.ts#L64)

清空所有静态注册的 Schemes (主要用于测试清理)

#### Parameters

##### scheme?

`string`

可选，仅清除指定 scheme

#### Returns

`void`

#### Inherited from

`RpcClientTransportManager.clearSchemes`

***

### ~~registerProtocol()~~

> `static` **registerProtocol**(`scheme`, `transportClass`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client-manager.ts:56](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/client-manager.ts#L56)

#### Parameters

##### scheme

`string`

##### transportClass

`any`

#### Returns

`void`

#### Deprecated

使用 bindScheme 代替

#### Inherited from

`RpcClientTransportManager.registerProtocol`
