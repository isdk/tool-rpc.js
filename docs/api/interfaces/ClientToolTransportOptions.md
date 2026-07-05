[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ClientToolTransportOptions

# Interface: ClientToolTransportOptions

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/client.ts:7](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/client.ts#L7)

## Extends

- [`ToolTransportOptions`](ToolTransportOptions.md)

## Extended by

- [`HttpClientToolTransportOptions`](HttpClientToolTransportOptions.md)
- [`MailboxClientTransportOptions`](MailboxClientTransportOptions.md)

## Indexable

> \[`key`: `string`\]: `any`

## Properties

### apiUrl?

> `optional` **apiUrl?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:11](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L11)

#### Inherited from

[`ToolTransportOptions`](ToolTransportOptions.md).[`apiUrl`](ToolTransportOptions.md#apiurl)

***

### manager?

> `optional` **manager?**: [`RpcTransportManager`](../classes/RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L10)

#### Inherited from

[`ToolTransportOptions`](ToolTransportOptions.md).[`manager`](ToolTransportOptions.md#manager)
