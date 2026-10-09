[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RouteClaim

# Interface: RouteClaim

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:30](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L30)

一条已声明的逻辑路由（prefix 粒度，rpc / discovery 各自计数）。

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:34](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L34)

声明该前缀时传入的 apiUrl，用于重建 ToolRpcRequest.apiUrl。

***

### discovery

> **discovery**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:40](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L40)

是否已声明发现路由。

***

### discoveryHandler?

> `optional` **discoveryHandler?**: () => `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:36](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L36)

#### Returns

`any`

***

### prefix

> **prefix**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:32](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L32)

归一化前缀，无尾斜杠；根为 '/'。

***

### registry?

> `optional` **registry?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:35](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L35)

***

### rpc

> **rpc**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:38](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L38)

是否已声明 RPC 路由。
