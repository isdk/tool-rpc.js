[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / withWildcardHost

# Function: withWildcardHost()

> **withWildcardHost**(`uri`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:263](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L263)

把 host 换成通配标记（`*`），其余部分不动。同样走 URL，不手拼。
用于「声明的 host 并不是实际绑定的 host」的 transport（见 HttpServerToolTransport）。

## Parameters

### uri

`string`

## Returns

`string`
