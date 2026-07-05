[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / MailboxServerTransportOptions

# Interface: MailboxServerTransportOptions

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:5](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L5)

## Extends

- [`ServerToolTransportOptions`](ServerToolTransportOptions.md)

## Indexable

> \[`key`: `string`\]: `any`

## Properties

### ~~address?~~

> `optional` **address?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:8](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L8)

#### Deprecated

use apiUrl instead

***

### apiUrl?

> `optional` **apiUrl?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:11](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L11)

#### Inherited from

[`ServerToolTransportOptions`](ServerToolTransportOptions.md).[`apiUrl`](ServerToolTransportOptions.md#apiurl)

***

### dispatcher?

> `optional` **dispatcher?**: [`RpcServerDispatcher`](../classes/RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:7](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L7)

#### Inherited from

[`ServerToolTransportOptions`](ServerToolTransportOptions.md).[`dispatcher`](ServerToolTransportOptions.md#dispatcher)

***

### mailbox?

> `optional` **mailbox?**: `Mailbox`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:6](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L6)

***

### manager?

> `optional` **manager?**: [`RpcTransportManager`](../classes/RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L10)

#### Inherited from

[`ServerToolTransportOptions`](ServerToolTransportOptions.md).[`manager`](ServerToolTransportOptions.md#manager)

***

### mode?

> `optional` **mode?**: `"push"` \| `"pull"`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:9](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L9)

***

### pullInterval?

> `optional` **pullInterval?**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-server.ts#L10)
