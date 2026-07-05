[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / HttpServerToolTransport

# Class: HttpServerToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:31](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L31)

HTTP 服务端传输协议。
支持在同一物理端口上通过 URL Path 挂载多个逻辑 Transport 实例。

## Extends

- [`ServerToolTransport`](ServerToolTransport.md)

## Constructors

### Constructor

> **new HttpServerToolTransport**(`options?`): `HttpServerToolTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:40](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L40)

#### Parameters

##### options?

[`HttpServerToolTransportOptions`](../interfaces/HttpServerToolTransportOptions.md)

#### Returns

`HttpServerToolTransport`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`constructor`](ServerToolTransport.md#constructor)

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:42](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L42)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`apiUrl`](ServerToolTransport.md#apiurl)

***

### canStream

> **canStream**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:45](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L45)

是否支持原生的流式传输 (如 HTTP 支持, Mailbox 通常不支持)

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`canStream`](ServerToolTransport.md#canstream)

***

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:44](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L44)

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`dispatcher`](ServerToolTransport.md#dispatcher)

***

### manager

> **manager**: [`RpcTransportManager`](RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L57)

所属管理器引用

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`manager`](ServerToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:43](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L43)

具体协议额外的配置或选项扩展

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`options`](ServerToolTransport.md#options)

## Methods

### \_start()

> **\_start**(`options`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:95](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L95)

启动物理监听（支持复用）

#### Parameters

##### options

###### host?

`string`

###### port?

`number`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`_start`](ServerToolTransport.md#_start)

***

### addDiscoveryHandler()

> **addDiscoveryHandler**(`apiUrl`, `handler`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:66](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L66)

#### Parameters

##### apiUrl

`string`

##### handler

() => `any`

#### Returns

`void`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`addDiscoveryHandler`](ServerToolTransport.md#adddiscoveryhandler)

***

### addRpcHandler()

> **addRpcHandler**(`apiUrl`, `options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:79](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L79)

#### Parameters

##### apiUrl

`string`

##### options?

`any`

#### Returns

`void`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`addRpcHandler`](ServerToolTransport.md#addrpchandler)

***

### getListenAddr()

> **getListenAddr**(): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:46](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L46)

获取物理层面的监听地址标识。
默认返回 apiUrl。用于识别物理底座复用。

#### Returns

`string`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getListenAddr`](ServerToolTransport.md#getlistenaddr)

***

### getRaw()

> **getRaw**(): `Server`\<*typeof* `IncomingMessage`, *typeof* `ServerResponse`\> \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:384](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L384)

#### Returns

`Server`\<*typeof* `IncomingMessage`, *typeof* `ServerResponse`\> \| `undefined`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getRaw`](ServerToolTransport.md#getraw)

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:62](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L62)

获取该实例声明负责的逻辑路由列表。
默认返回 ["/"] 表示接管该物理地址下的全量路径。

#### Returns

`string`[]

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getRoutes`](ServerToolTransport.md#getroutes)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`processIncomingCall`](ServerToolTransport.md#processincomingcall)

***

### sendRpcResponse()

> `protected` **sendRpcResponse**(`rpcRes`, `rawRes`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:317](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L317)

#### Parameters

##### rpcRes

[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)

##### rawRes

`ServerResponse`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`sendRpcResponse`](ServerToolTransport.md#sendrpcresponse)

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

[`ServerToolTransport`](ServerToolTransport.md).[`setApiUrl`](ServerToolTransport.md#setapiurl)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`start`](ServerToolTransport.md#start)

***

### stop()

> **stop**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:138](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L138)

停止物理监听

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`stop`](ServerToolTransport.md#stop)

***

### toRpcRequest()

> `protected` **toRpcRequest**(`rawReq`, `rawRes?`): `Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:244](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L244)

#### Parameters

##### rawReq

`IncomingMessage`

##### rawRes?

`ServerResponse`\<`IncomingMessage`\>

#### Returns

`Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`toRpcRequest`](ServerToolTransport.md#torpcrequest)
