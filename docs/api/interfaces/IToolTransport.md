[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / IToolTransport

# Interface: IToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:16](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/transports/base.ts#L16)

## Extended by

- [`IClientToolTransport`](IClientToolTransport.md)
- [`IServerToolTransport`](IServerToolTransport.md)

## Indexable

\[`name`: `string`\]: `any`

## Properties

### apiRoot

> **apiRoot**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:22](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/transports/base.ts#L22)

The root endpoint for the remote service.
For HTTP, this is a URL. For IPC, it could be a channel name.

***

### options?

> `optional` **options**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:26](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/transports/base.ts#L26)

Additional options for the transport start or fetch, passed by mount.

***

### Tools

> **Tools**: *typeof* `ToolFunc`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:17](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/transports/base.ts#L17)

## Methods

### mount()

> **mount**(`Tools`, `apiRoot?`, `options?`): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:28](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/transports/base.ts#L28)

#### Parameters

##### Tools

*typeof* `ToolFunc`

##### apiRoot?

`string`

##### options?

`any`

#### Returns

`any`
