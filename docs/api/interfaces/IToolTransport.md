[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / IToolTransport

# Interface: IToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:18](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L18)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extended by

- [`IServerToolTransport`](IServerToolTransport.md)
- [`IClientToolTransport`](IClientToolTransport.md)

## Indexable

> \[`name`: `string`\]: `any`

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:29](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L29)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

***

### manager?

> `optional` **manager?**: [`RpcTransportManager`](../classes/RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:22](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L22)

所属管理器引用

***

### options?

> `optional` **options?**: [`ToolTransportOptions`](ToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:34](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L34)

具体协议额外的配置或选项扩展

## Methods

### close()?

> `optional` **close**(): `void` \| `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:49](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L49)

物理层关闭句柄 (可选)

#### Returns

`void` \| `Promise`\<`void`\>

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
