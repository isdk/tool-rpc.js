[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcMethodHandler

# Type Alias: RpcMethodHandler()

> **RpcMethodHandler** = (`params`, `context?`) => `Promise`\<`any`\> \| `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:14](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/transports/base.ts#L14)

The generic handler for a remote procedure call (RPC) method.
It receives the parameters and returns the result.

## Parameters

### params

`any`

The parameters for the RPC method.

### context?

`any`

Optional context, like the raw request object from the underlying framework.

## Returns

`Promise`\<`any`\> \| `any`

The result of the RPC method.
