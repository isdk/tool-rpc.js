[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / unixSocketPath

# Function: unixSocketPath()

> **unixSocketPath**(`uri`): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:174](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L174)

从 canonical `unix:` URI 取回可直接 listen 的 socket 路径（按段 decode，`/`
仍是分隔符，段内 `%2F` 还原成字面斜杠）；不是 unix 身份时返回 undefined。

## Parameters

### uri

`string`

## Returns

`string` \| `undefined`
