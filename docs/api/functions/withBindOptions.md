[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / withBindOptions

# Function: withBindOptions()

> **withBindOptions**(`base`, `options?`): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:239](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L239)

用显式 bind 参数改写已有声明身份的 authority。
socket 声明优先于 host/port（与 physicalUriFromBind 同一优先级）。

为什么 bind 参数要进 key：`start({ port: 3001 })` 是调用方**声明**的绑定，
与 apiUrl 冲突时 apiUrl 才是过时的那一个——不改写就会把身份停在旧端口上，
对真实底座漏报、对旧底座过报冲突。反之 `port: 0`（内核挑端口）属于观测，
不改写，key 跨 start 边界仍然稳定。

返回 undefined 表示没什么可改写（无 bind 参数，或 base 不是按 authority
寻址的 scheme），调用方沿用 apiUrl 派生的身份。

## Parameters

### base

`string`

### options?

[`BindOptions`](../interfaces/BindOptions.md)

## Returns

`string` \| `undefined`
