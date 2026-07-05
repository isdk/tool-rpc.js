[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcTaskRetentionConfig

# Interface: RpcTaskRetentionConfig

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:58](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L58)

细粒度的保留策略配置

## Properties

### maxRetentionMs?

> `optional` **maxRetentionMs?**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:64](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L64)

结果保留的硬性上限时间 (ms)，无论何种模式超过此时间必删

***

### mode

> **mode**: `number` \| `"once"` \| [`Once`](../enumerations/RpcTaskRetentionMode.md#once)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:60](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L60)

保留模式或毫秒数

***

### onceFallbackMs?

> `optional` **onceFallbackMs?**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:62](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L62)

'once' 模式下的物理清理兜底时间 (ms)
