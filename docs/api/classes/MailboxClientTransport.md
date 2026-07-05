[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / MailboxClientTransport

# Class: MailboxClientTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:24](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L24)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`ClientToolTransport`](ClientToolTransport.md)

## Constructors

### Constructor

> **new MailboxClientTransport**(`options`): `MailboxClientTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:33](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L33)

#### Parameters

##### options

[`MailboxClientTransportOptions`](../interfaces/MailboxClientTransportOptions.md)

#### Returns

`MailboxClientTransport`

#### Overrides

[`ClientToolTransport`](ClientToolTransport.md).[`constructor`](ClientToolTransport.md#constructor)

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:17](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L17)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`apiUrl`](ClientToolTransport.md#apiurl)

***

### clientAddress

> `protected` **clientAddress**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:27](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L27)

***

### isInternalMailbox

> `protected` **isInternalMailbox**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:31](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L31)

***

### mailbox

> `protected` **mailbox**: `Mailbox`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:25](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L25)

***

### manager

> **manager**: [`RpcTransportManager`](RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L57)

所属管理器引用

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`manager`](ClientToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ClientToolTransportOptions`](../interfaces/ClientToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:18](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L18)

具体协议额外的配置或选项扩展

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`options`](ClientToolTransport.md#options)

***

### pendingRequests

> `protected` **pendingRequests**: `Map`\<`string`, `PendingRequest`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:28](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L28)

***

### serverAddress

> `protected` **serverAddress**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:26](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L26)

***

### subscription

> `protected` **subscription**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:29](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L29)

***

### timeout

> `protected` **timeout**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:30](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L30)

## Accessors

### apiRoot

#### Get Signature

> **get** **apiRoot**(): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:27](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L27)

##### Deprecated

use apiUrl instead

##### Returns

`string`

#### Set Signature

> **set** **apiRoot**(`val`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:29](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L29)

##### Deprecated

use apiUrl instead

##### Parameters

###### val

`string`

##### Returns

`void`

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`apiRoot`](ClientToolTransport.md#apiroot)

## Methods

### \_fetch()

> **\_fetch**(`name`, `args?`, `act?`, `id?`, `fetchOptions?`): `Promise`\<`unknown`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:91](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L91)

#### Parameters

##### name

`string`

##### args?

`any`

##### act?

`string`

##### id?

`any`

##### fetchOptions?

`any`

#### Returns

`Promise`\<`unknown`\>

#### Overrides

[`ClientToolTransport`](ClientToolTransport.md).[`_fetch`](ClientToolTransport.md#_fetch)

***

### fetch()

> **fetch**(`name`, `args?`, `act?`, `subName?`, `fetchOptions?`, `toolTimeout?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:49](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L49)

#### Parameters

##### name

`string`

##### args?

`any`

##### act?

`string`

##### subName?

`any`

##### fetchOptions?

`any`

##### toolTimeout?

`any`

#### Returns

`Promise`\<`any`\>

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`fetch`](ClientToolTransport.md#fetch)

***

### loadApis()

> **loadApis**(`options?`): `Promise`\<[`Funcs`](../interfaces/Funcs.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:41](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L41)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<[`Funcs`](../interfaces/Funcs.md)\>

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`loadApis`](ClientToolTransport.md#loadapis)

***

### mount()

> **mount**(`toolsClass`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:35](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L35)

Mounts the transport to a tools class, setting the default apiUrl for that class.

#### Parameters

##### toolsClass

`any`

The tools class (e.g., ClientTools) to mount to.

#### Returns

`void`

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`mount`](ClientToolTransport.md#mount)

***

### onResponse()

> `protected` **onResponse**(`message`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:60](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L60)

#### Parameters

##### message

`MailMessage`

#### Returns

`void`

***

### pollTaskStatus()

> **pollTaskStatus**(`taskId`, `parentFetchOptions?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:196](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L196)

模块化复用的轮询探查接口

#### Parameters

##### taskId

`string`

##### parentFetchOptions?

`any` = `{}`

#### Returns

`Promise`\<`any`\>

#### Inherited from

[`ClientToolTransport`](ClientToolTransport.md).[`pollTaskStatus`](ClientToolTransport.md#polltaskstatus)

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

[`ClientToolTransport`](ClientToolTransport.md).[`setApiUrl`](ClientToolTransport.md#setapiurl)

***

### start()

> **start**(): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:53](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L53)

#### Returns

`Promise`\<`void`\>

***

### stop()

> **stop**(): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:161](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L161)

#### Returns

`Promise`\<`void`\>

***

### toObject()

> **toObject**(`res`, `args?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:156](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L156)

#### Parameters

##### res

`any`

##### args?

`any`

#### Returns

`Promise`\<`any`\>

#### Overrides

[`ClientToolTransport`](ClientToolTransport.md).[`toObject`](ClientToolTransport.md#toobject)
