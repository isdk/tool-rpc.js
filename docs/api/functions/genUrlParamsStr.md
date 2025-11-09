[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / genUrlParamsStr

# Function: genUrlParamsStr()

> **genUrlParamsStr**(`objParam`, `omitQuestionMark?`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/gen-url-params.ts:7](https://github.com/isdk/tool-rpc.js/blob/1c4d9feeb982e305e597719fcf1bcdf46906f1cb/src/transports/gen-url-params.ts#L7)

Utility to serialize an object into a URL query parameter string.

## Parameters

### objParam

`any`

The parameter object.

### omitQuestionMark?

`boolean`

If true, omits the leading '?' from the result. Defaults to false.

## Returns

`string`

The URL-encoded query string or an empty string.
