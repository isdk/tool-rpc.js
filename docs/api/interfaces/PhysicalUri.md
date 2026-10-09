[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / PhysicalUri

# Interface: PhysicalUri

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:40](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L40)

## Properties

### host?

> `optional` **host?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:44](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L44)

归一化后的 host；通配为 `*`；opaque 身份为 undefined

***

### opaque

> **opaque**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:50](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L50)

无法按 authority 解析（unix socket、进程内实例标识等）

***

### port?

> `optional` **port?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:46](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L46)

端口字符串，已按 DEFAULT_PORTS 补齐；两者都没有时为空串

***

### scheme?

> `optional` **scheme?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:42](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L42)

含冒号的 scheme，如 `http:`；opaque 身份为 undefined

***

### wildcard

> **wildcard**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:48](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L48)

该身份是否监听通配地址（覆盖任意 host）
