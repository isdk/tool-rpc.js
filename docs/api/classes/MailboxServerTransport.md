[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / MailboxServerTransport

# Class: MailboxServerTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:13](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L13)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`ServerToolTransport`](ServerToolTransport.md)

## Constructors

### Constructor

> **new MailboxServerTransport**(`options?`): `MailboxServerTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:24](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L24)

#### Parameters

##### options?

[`MailboxServerTransportOptions`](../interfaces/MailboxServerTransportOptions.md) = `{}`

#### Returns

`MailboxServerTransport`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`constructor`](ServerToolTransport.md#constructor)

## Properties

### apiPrefix

> `protected` **apiPrefix**: `string` = `'/'`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:16](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L16)

***

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

### discoveryHandlerInfo

> `protected` **discoveryHandlerInfo**: \{ `handler`: () => `any`; `prefix`: `string`; \} \| `null` = `null`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:17](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L17)

***

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:44](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L44)

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`dispatcher`](ServerToolTransport.md#dispatcher)

***

### isInternalMailbox

> `protected` **isInternalMailbox**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:22](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L22)

***

### isRunning

> `protected` **isRunning**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:21](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L21)

***

### listenAddress

> `protected` **listenAddress**: `string` = `''`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:15](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L15)

***

### mailbox

> `protected` **mailbox**: `Mailbox`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:14](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L14)

***

### manager

> **manager**: [`RpcTransportManager`](RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L57)

所属管理器引用

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`manager`](ServerToolTransport.md#manager)

***

### mode

> `protected` **mode**: `"push"` \| `"pull"` = `'push'`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:19](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L19)

***

### options?

> `optional` **options?**: [`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:43](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L43)

具体协议额外的配置或选项扩展

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`options`](ServerToolTransport.md#options)

***

### pullInterval

> `protected` **pullInterval**: `number` = `1000`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:20](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L20)

***

### subscription

> `protected` **subscription**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:18](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L18)

## Methods

### \_start()

> **\_start**(`options?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:174](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L174)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`_start`](ServerToolTransport.md#_start)

***

### addDiscoveryHandler()

> **addDiscoveryHandler**(`apiUrl`, `handler`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:57](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L57)

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:62](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L62)

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

### drainBacklog()

> `protected` **drainBacklog**(`address`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:191](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L191)

#### Parameters

##### address

`string`

#### Returns

`Promise`\<`void`\>

***

### extractPath()

> `protected` **extractPath**(`urlStr`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:45](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L45)

#### Parameters

##### urlStr

`string`

#### Returns

`string`

***

### getListenAddr()

> **getListenAddr**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:52](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L52)

获取物理层面的监听地址标识。
默认返回 apiUrl。用于识别物理底座复用。

#### Returns

`string` \| `string`[]

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`getListenAddr`](ServerToolTransport.md#getlistenaddr)

***

### getRaw()

> **getRaw**(): `Mailbox`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:230](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L230)

#### Returns

`Mailbox`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getRaw`](ServerToolTransport.md#getraw)

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:56](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L56)

获取该实例声明负责的逻辑路由列表。
默认返回 ["/"] 表示接管该物理地址下的全量路径。

#### Returns

`string`[]

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`getRoutes`](ServerToolTransport.md#getroutes)

***

### onReceive()

> `protected` **onReceive**(`message`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:66](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L66)

#### Parameters

##### message

`MailMessage`

#### Returns

`Promise`\<`void`\>

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

### runPullLoop()

> `protected` **runPullLoop**(`address`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:201](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L201)

#### Parameters

##### address

`string`

#### Returns

`Promise`\<`void`\>

***

### sendRpcResponse()

> `protected` **sendRpcResponse**(`rpcRes`, `rawRes`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:140](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L140)

#### Parameters

##### rpcRes

[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)

##### rawRes

`MailMessage`

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:219](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L219)

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

> `protected` **toRpcRequest**(`rawReq`): `Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:91](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L91)

#### Parameters

##### rawReq

`MailMessage`

#### Returns

`Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`toRpcRequest`](ServerToolTransport.md#torpcrequest)
