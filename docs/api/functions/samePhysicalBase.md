[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / samePhysicalBase

# Function: samePhysicalBase()

> **samePhysicalBase**(`a`, `b`): `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:303](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L303)

两个声明身份是否指向同一物理底座。

依据实测（两个 server 同时监听）：`0.0.0.0:3000` 与 `127.0.0.1:3000` 在两个方向上
都 EADDRINUSE，`::`（双栈）同样覆盖 `127.0.0.1`；而两个**不同**的具体 host 同端口
在 Linux 上可以共存。所以包含关系是单向的：通配覆盖具体 host，具体 host 之间不互斥。
因此这里判定「同一底座」，但不把两者塌缩成同一个 key（塌缩会丢掉真实 host）。

## Parameters

### a

`string`

### b

`string`

## Returns

`boolean`
