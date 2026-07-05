[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ClientToolTransport

# Abstract Class: ClientToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:16](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L16)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`ToolTransport`](ToolTransport.md)

## Extended by

- [`HttpClientToolTransport`](HttpClientToolTransport.md)
- [`MailboxClientTransport`](MailboxClientTransport.md)

## Implements

- [`IClientToolTransport`](../interfaces/IClientToolTransport.md)

## Constructors

### Constructor

> **new ClientToolTransport**(`apiUrl`, `options?`): `ClientToolTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:20](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L20)

#### Parameters

##### apiUrl

`string`

##### options?

[`ClientToolTransportOptions`](../interfaces/ClientToolTransportOptions.md)

#### Returns

`ClientToolTransport`

#### Overrides

[`ToolTransport`](ToolTransport.md).[`constructor`](ToolTransport.md#constructor)

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:17](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L17)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Implementation of

[`IClientToolTransport`](../interfaces/IClientToolTransport.md).[`apiUrl`](../interfaces/IClientToolTransport.md#apiurl)

#### Overrides

[`ToolTransport`](ToolTransport.md).[`apiUrl`](ToolTransport.md#apiurl)

***

### manager

> **manager**: [`RpcTransportManager`](RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L57)

所属管理器引用

#### Implementation of

[`IClientToolTransport`](../interfaces/IClientToolTransport.md).[`manager`](../interfaces/IClientToolTransport.md#manager)

#### Inherited from

[`ToolTransport`](ToolTransport.md).[`manager`](ToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ClientToolTransportOptions`](../interfaces/ClientToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:18](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L18)

具体协议额外的配置或选项扩展

#### Implementation of

[`IClientToolTransport`](../interfaces/IClientToolTransport.md).[`options`](../interfaces/IClientToolTransport.md#options)

#### Overrides

[`ToolTransport`](ToolTransport.md).[`options`](ToolTransport.md#options)

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

## Methods

### \_fetch()

> `abstract` **\_fetch**(`name`, `args?`, `act?`, `id?`, `fetchOptions?`): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:212](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L212)

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

`any`

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

#### Implementation of

[`IClientToolTransport`](../interfaces/IClientToolTransport.md).[`fetch`](../interfaces/IClientToolTransport.md#fetch)

***

### loadApis()

> **loadApis**(`options?`): `Promise`\<[`Funcs`](../interfaces/Funcs.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:41](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L41)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<[`Funcs`](../interfaces/Funcs.md)\>

#### Implementation of

[`IClientToolTransport`](../interfaces/IClientToolTransport.md).[`loadApis`](../interfaces/IClientToolTransport.md#loadapis)

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

### toObject()

> `abstract` **toObject**(`res`, `args?`): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:213](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L213)

#### Parameters

##### res

`any`

##### args?

`any`

#### Returns

`any`
