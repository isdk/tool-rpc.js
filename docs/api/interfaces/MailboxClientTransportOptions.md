[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / MailboxClientTransportOptions

# Interface: MailboxClientTransportOptions

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:6](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L6)

## Extends

- [`ClientToolTransportOptions`](ClientToolTransportOptions.md)

## Indexable

> \[`key`: `string`\]: `any`

## Properties

### apiUrl?

> `optional` **apiUrl?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:11](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L11)

#### Inherited from

[`ClientToolTransportOptions`](ClientToolTransportOptions.md).[`apiUrl`](ClientToolTransportOptions.md#apiurl)

***

### clientAddress?

> `optional` **clientAddress?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L10)

***

### mailbox?

> `optional` **mailbox?**: `Mailbox`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:7](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L7)

***

### manager?

> `optional` **manager?**: [`RpcTransportManager`](../classes/RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L10)

#### Inherited from

[`ClientToolTransportOptions`](ClientToolTransportOptions.md).[`manager`](ClientToolTransportOptions.md#manager)

***

### ~~serverAddress?~~

> `optional` **serverAddress?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:9](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L9)

#### Deprecated

use apiUrl instead

***

### timeout?

> `optional` **timeout?**: `number` \| \{ `keepAliveOnTimeout?`: `boolean`; `streamIdleTimeout?`: `number`; `value`: `number`; \}

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-client.ts:11](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/mailbox-client.ts#L11)
