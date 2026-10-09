[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / physicalUriFromBind

# Function: physicalUriFromBind()

> **physicalUriFromBind**(`options?`): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:211](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L211)

从显式 bind 参数**造**一个声明身份，供 apiUrl 没有 URL 表示的 transport 用
（裸 path 前缀、只写在 listen 参数里的 socket）。返回 undefined 表示信息不够：
既没有 socket，也没有可用端口（`port: 0` 是“由内核挑”，属于观测，不能进 key）。
host 未指定时按通配 `*`：通配覆盖任意具体 host，宁可多报冲突也不漏报。

## Parameters

### options?

[`BindOptions`](../interfaces/BindOptions.md)

## Returns

`string` \| `undefined`
