[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / BindOptions

# Interface: BindOptions

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:184](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L184)

`start()` / transport options 里的显式 bind 参数。

## Properties

### host?

> `optional` **host?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:185](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L185)

***

### path?

> `optional` **path?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:189](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L189)

unix socket 路径（Fastify 用 path，Node 用 path/socketPath）；指定 port 时被忽略。

***

### port?

> `optional` **port?**: `string` \| `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:187](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L187)

`0` 表示由内核挑端口，属于观测而非声明，不参与 key。

***

### socket?

> `optional` **socket?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:191](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L191)

***

### socketPath?

> `optional` **socketPath?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:190](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L190)
