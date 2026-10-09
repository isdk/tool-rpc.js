[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / IServerToolTransport

# Interface: IServerToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:43](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L43)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`IToolTransport`](IToolTransport.md)

## Indexable

> \[`name`: `string`\]: `any`

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:29](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L29)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`apiUrl`](IToolTransport.md#apiurl)

***

### canStream?

> `optional` **canStream?**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:47](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L47)

是否支持原生的流式传输 (如 HTTP 支持, Mailbox 通常不支持)

***

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](../classes/RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:44](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L44)

***

### manager?

> `optional` **manager?**: `RpcClientTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:22](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L22)

所属管理器引用

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`manager`](IToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ToolTransportOptions`](ToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:34](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L34)

具体协议额外的配置或选项扩展

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`options`](IToolTransport.md#options)

## Methods

### close()?

> `optional` **close**(): `void` \| `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:49](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L49)

物理层关闭句柄 (可选)

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

[`IToolTransport`](IToolTransport.md).[`close`](IToolTransport.md#close)

***

### getBaseUrl()?

> `optional` **getBaseUrl**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:66](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L66)

声明身份：该实例所在物理底座的 canonical URI（scheme + authority，不含 path）。
构造期即可得；`start()` 里的显式 bind 参数会改写它，内核观测（port 0）不会。
Manager 的路由审计、物理底座复用池、请求分发都以它为 key。默认返回 apiUrl；
无 URL 表示的 transport 应自行构造一个 URI 代替（如 unix:/run/ai.sock、mem://bus-a）。
声明为可选，以免第三方直接 implements 该接口的类编译失败。

#### Returns

`string` \| `string`[]

***

### getBoundAddress()?

> `optional` **getBoundAddress**(): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:72](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L72)

实际绑定观测：仅在 start 之后可得，未监听时返回 undefined。
只用于日志与 port 0 场景下补全声明身份，不得作为审计 / 池 key。

#### Returns

`string` \| `undefined`

***

### ~~getListenAddr()~~

> **getListenAddr**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:78](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L78)

#### Returns

`string` \| `string`[]

#### Deprecated

改用 getBaseUrl()（声明身份）或 getBoundAddress()（绑定观测）。
本名保留为别名，首次调用会警告一次。

***

### getRaw()?

> `optional` **getRaw**(): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:86](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L86)

#### Returns

`any`

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:84](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L84)

获取该实例声明负责的逻辑路由列表。
默认返回 ["/"] 表示接管该物理地址下的全量路径。

#### Returns

`string`[]

***

### start()

> **start**(`options?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:52](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L52)

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:57](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L57)

停止物理监听

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`IToolTransport`](IToolTransport.md).[`stop`](IToolTransport.md#stop)
