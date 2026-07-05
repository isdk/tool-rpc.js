[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / IClientToolTransport

# Interface: IClientToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L10)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`IToolTransport`](IToolTransport.md)

## Indexable

> \[`name`: `string`\]: `any`

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:29](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L29)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`apiUrl`](IToolTransport.md#apiurl)

***

### manager?

> `optional` **manager?**: [`RpcTransportManager`](../classes/RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:22](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L22)

所属管理器引用

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`manager`](IToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ToolTransportOptions`](ToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:34](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L34)

具体协议额外的配置或选项扩展

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`options`](IToolTransport.md#options)

## Methods

### close()?

> `optional` **close**(): `void` \| `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:49](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L49)

物理层关闭句柄 (可选)

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`close`](IToolTransport.md#close)

***

### fetch()

> **fetch**(`name`, `args?`, `act?`, `subName?`, `options?`, `toolTimeout?`): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:12](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L12)

#### Parameters

##### name

`string`

##### args?

`any`

##### act?

`string`

##### subName?

`any`

##### options?

`any`

##### toolTimeout?

`any`

#### Returns

`any`

***

### loadApis()

> **loadApis**(`options?`): `Promise`\<[`Funcs`](Funcs.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:11](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L11)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<[`Funcs`](Funcs.md)\>

***

### start()?

> `optional` **start**(`options?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:39](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L39)

启动服务 (仅服务端有效)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`\>

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`start`](IToolTransport.md#start)

***

### stop()?

> `optional` **stop**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:44](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L44)

停止服务或回收资源

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`stop`](IToolTransport.md#stop)
