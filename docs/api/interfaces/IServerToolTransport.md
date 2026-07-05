[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / IServerToolTransport

# Interface: IServerToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L10)

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

### canStream?

> `optional` **canStream?**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:14](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L14)

是否支持原生的流式传输 (如 HTTP 支持, Mailbox 通常不支持)

***

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](../classes/RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:11](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L11)

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

### getListenAddr()

> **getListenAddr**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:30](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L30)

获取物理层面的监听地址标识。
默认返回 apiUrl。用于识别物理底座复用。

#### Returns

`string` \| `string`[]

***

### getRaw()?

> `optional` **getRaw**(): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:38](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L38)

#### Returns

`any`

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:36](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L36)

获取该实例声明负责的逻辑路由列表。
默认返回 ["/"] 表示接管该物理地址下的全量路径。

#### Returns

`string`[]

***

### start()

> **start**(`options?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:19](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L19)

启动物理监听

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`\>

#### Overrides

[`IToolTransport`](IToolTransport.md).[`start`](IToolTransport.md#start)

***

### stop()

> **stop**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:24](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L24)

停止物理监听

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`IToolTransport`](IToolTransport.md).[`stop`](IToolTransport.md#stop)
