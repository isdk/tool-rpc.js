[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RouteClaimOptions

# Interface: RouteClaimOptions

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:20](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L20)

声明路由时可携带的逻辑信息。

## Properties

### discoveryHandler?

> `optional` **discoveryHandler?**: () => `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:24](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L24)

该前缀的发现处理器。

#### Returns

`any`

***

### registry?

> `optional` **registry?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:22](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L22)

该前缀使用的工具注册表；请求期解析，避免后一次挂载覆盖前一次。

***

### remount?

> `optional` **remount?**: [`RouteRemountMode`](../type-aliases/RouteRemountMode.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:26](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L26)

重复声明时的行为，默认 'replace'。
