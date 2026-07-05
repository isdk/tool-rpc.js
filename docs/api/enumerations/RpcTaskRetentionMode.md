[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcTaskRetentionMode

# Enumeration: RpcTaskRetentionMode

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:46](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L46)

任务完成后结果保留模式

## Enumeration Members

### None

> **None**: `0`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:48](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L48)

任务完成后立即销毁

***

### Once

> **Once**: `"once"`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:52](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L52)

保留至第一次成功读取 (GET)

***

### Permanent

> **Permanent**: `-1`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:50](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L50)

永久保留 (直至进程结束或手动删除)
