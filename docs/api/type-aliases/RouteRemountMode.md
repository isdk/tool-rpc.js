[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RouteRemountMode

# Type Alias: RouteRemountMode

> **RouteRemountMode** = `"replace"` \| `"throw"`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:17](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L17)

同一前缀的同类路由被重复声明时的处理方式。
- 'replace'（默认）：新的 registry / discoveryHandler 接管已声明的路由，不再重复注册物理路由。
- 'throw'：调用 onDuplicateRoute 抛出（框架自有的重复路由错误，或基类通用错误）。
