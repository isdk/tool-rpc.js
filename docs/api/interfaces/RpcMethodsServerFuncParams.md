[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcMethodsServerFuncParams

# Interface: RpcMethodsServerFuncParams

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/rpc-methods-server-tool.ts:6](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/rpc-methods-server-tool.ts#L6)

Defines the structure for parameters passed to a `ServerTools` function.
By convention, it includes optional `_req` and `_res` properties for direct
access to the underlying transport's request and response objects (e.g., from Node.js http).

## Extends

- [`ServerFuncParams`](ServerFuncParams.md)

## Extended by

- [`ResServerFuncParams`](ResServerFuncParams.md)

## Indexable

\[`name`: `string`\]: `any`

## Properties

### \_req?

> `optional` **\_req**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/server-tools.ts:15](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/server-tools.ts#L15)

The underlying request object from the transport layer (e.g., `IncomingMessage`).

#### Inherited from

[`ServerFuncParams`](ServerFuncParams.md).[`_req`](ServerFuncParams.md#_req)

***

### \_res?

> `optional` **\_res**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/server-tools.ts:20](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/server-tools.ts#L20)

The underlying response or reply object from the transport layer (e.g., `ServerResponse`).

#### Inherited from

[`ServerFuncParams`](ServerFuncParams.md).[`_res`](ServerFuncParams.md#_res)

***

### act?

> `optional` **act**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/rpc-methods-server-tool.ts:7](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/rpc-methods-server-tool.ts#L7)
