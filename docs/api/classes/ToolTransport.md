[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ToolTransport

# Abstract Class: ToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:54](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L54)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extended by

- [`ServerToolTransport`](ServerToolTransport.md)
- [`ClientToolTransport`](ClientToolTransport.md)

## Implements

- [`IToolTransport`](../interfaces/IToolTransport.md)

## Constructors

### Constructor

> **new ToolTransport**(`options?`): `ToolTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:59](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L59)

#### Parameters

##### options?

[`ToolTransportOptions`](../interfaces/ToolTransportOptions.md)

#### Returns

`ToolTransport`

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:55](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L55)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Implementation of

[`IToolTransport`](../interfaces/IToolTransport.md).[`apiUrl`](../interfaces/IToolTransport.md#apiurl)

***

### manager

> **manager**: [`RpcTransportManager`](RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L57)

所属管理器引用

#### Implementation of

[`IToolTransport`](../interfaces/IToolTransport.md).[`manager`](../interfaces/IToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ToolTransportOptions`](../interfaces/ToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:56](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L56)

具体协议额外的配置或选项扩展

#### Implementation of

[`IToolTransport`](../interfaces/IToolTransport.md).[`options`](../interfaces/IToolTransport.md#options)

## Methods

### setApiUrl()

> **setApiUrl**(`apiUrl`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:67](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L67)

#### Parameters

##### apiUrl

`string`

#### Returns

`void`
