[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ServerToolTransport

# Abstract Class: ServerToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:41](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L41)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`ToolTransport`](ToolTransport.md)

## Extended by

- [`HttpServerToolTransport`](HttpServerToolTransport.md)
- [`MailboxServerTransport`](MailboxServerTransport.md)

## Implements

- [`IServerToolTransport`](../interfaces/IServerToolTransport.md)

## Constructors

### Constructor

> **new ServerToolTransport**(`options?`): `ServerToolTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:47](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L47)

#### Parameters

##### options?

[`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

#### Returns

`ServerToolTransport`

#### Overrides

[`ToolTransport`](ToolTransport.md).[`constructor`](ToolTransport.md#constructor)

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:42](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L42)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`apiUrl`](../interfaces/IServerToolTransport.md#apiurl)

#### Overrides

[`ToolTransport`](ToolTransport.md).[`apiUrl`](ToolTransport.md#apiurl)

***

### canStream

> **canStream**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:45](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L45)

是否支持原生的流式传输 (如 HTTP 支持, Mailbox 通常不支持)

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`canStream`](../interfaces/IServerToolTransport.md#canstream)

***

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:44](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L44)

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`dispatcher`](../interfaces/IServerToolTransport.md#dispatcher)

***

### manager

> **manager**: [`RpcTransportManager`](RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L57)

所属管理器引用

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`manager`](../interfaces/IServerToolTransport.md#manager)

#### Inherited from

[`ToolTransport`](ToolTransport.md).[`manager`](ToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:43](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L43)

具体协议额外的配置或选项扩展

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`options`](../interfaces/IServerToolTransport.md#options)

#### Overrides

[`ToolTransport`](ToolTransport.md).[`options`](ToolTransport.md#options)

## Methods

### \_start()

> `abstract` **\_start**(`options?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:119](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L119)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`\>

***

### addDiscoveryHandler()

> `abstract` **addDiscoveryHandler**(`apiUrl`, `handler`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:117](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L117)

#### Parameters

##### apiUrl

`string`

##### handler

() => `any`

#### Returns

`void`

***

### addRpcHandler()

> `abstract` **addRpcHandler**(`apiUrl`, `options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:118](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L118)

#### Parameters

##### apiUrl

`string`

##### options?

`any`

#### Returns

`void`

***

### getListenAddr()

> **getListenAddr**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:52](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L52)

获取物理层面的监听地址标识。
默认返回 apiUrl。用于识别物理底座复用。

#### Returns

`string` \| `string`[]

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getListenAddr`](../interfaces/IServerToolTransport.md#getlistenaddr)

***

### getRaw()?

> `optional` **getRaw**(): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:121](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L121)

#### Returns

`any`

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getRaw`](../interfaces/IServerToolTransport.md#getraw)

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:56](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L56)

获取该实例声明负责的逻辑路由列表。
默认返回 ["/"] 表示接管该物理地址下的全量路径。

#### Returns

`string`[]

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getRoutes`](../interfaces/IServerToolTransport.md#getroutes)

***

### processIncomingCall()

> `protected` **processIncomingCall**(`rawReq`, `rawRes`, `registry?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:69](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L69)

Template Method：处理物理请求流水线。
下层具体协议收到请求后，将其转化为内部结构，送入 Dispatcher 并写回。

#### Parameters

##### rawReq

`any`

##### rawRes

`any`

##### registry?

`any`

#### Returns

`Promise`\<`void`\>

***

### sendRpcResponse()

> `abstract` `protected` **sendRpcResponse**(`rpcRes`, `rawRes`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:115](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L115)

#### Parameters

##### rpcRes

[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)

##### rawRes

`any`

#### Returns

`Promise`\<`void`\>

***

### setApiUrl()

> **setApiUrl**(`apiUrl`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:67](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L67)

#### Parameters

##### apiUrl

`string`

#### Returns

`void`

#### Inherited from

[`ToolTransport`](ToolTransport.md).[`setApiUrl`](ToolTransport.md#setapiurl)

***

### start()

> **start**(`options?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:60](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L60)

启动物理监听

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`\>

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`start`](../interfaces/IServerToolTransport.md#start)

***

### stop()

> `abstract` **stop**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:120](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L120)

停止物理监听

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`stop`](../interfaces/IServerToolTransport.md#stop)

***

### toRpcRequest()

> `abstract` `protected` **toRpcRequest**(`rawReq`, `rawRes?`): `Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:114](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L114)

#### Parameters

##### rawReq

`any`

##### rawRes?

`any`

#### Returns

`Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>
