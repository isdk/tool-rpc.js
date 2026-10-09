[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ServerToolTransportOptions

# Interface: ServerToolTransportOptions

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:8](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L8)

## Extends

- [`ToolTransportOptions`](ToolTransportOptions.md)

## Extended by

- [`HttpServerToolTransportOptions`](HttpServerToolTransportOptions.md)
- [`MailboxServerTransportOptions`](MailboxServerTransportOptions.md)

## Indexable

> \[`key`: `string`\]: `any`

## Properties

### apiUrl?

> `optional` **apiUrl?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:11](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L11)

#### Inherited from

[`ToolTransportOptions`](ToolTransportOptions.md).[`apiUrl`](ToolTransportOptions.md#apiurl)

***

### dispatcher?

> `optional` **dispatcher?**: [`RpcServerDispatcher`](../classes/RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:9](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L9)

***

### manager?

> `optional` **manager?**: `RpcClientTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:10](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L10)

#### Inherited from

[`ToolTransportOptions`](ToolTransportOptions.md).[`manager`](ToolTransportOptions.md#manager)
