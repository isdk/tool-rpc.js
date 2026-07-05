[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RPC\_DEFAULTS

# Variable: RPC\_DEFAULTS

> `const` **RPC\_DEFAULTS**: `object`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:32](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L32)

RPC 协议默认配置值

## Type Declaration

### GLOBAL\_TIMEOUT\_MS

> **GLOBAL\_TIMEOUT\_MS**: `number` = `30000`

默认全局硬超时时间 (ms)

### ONCE\_FALLBACK\_MS

> **ONCE\_FALLBACK\_MS**: `number` = `3600000`

'once' 模式下的物理清理兜底时间 (ms)，默认 1小时

### RETRY\_AFTER\_MS

> **RETRY\_AFTER\_MS**: `number` = `1000`

默认后台任务轮询间隔 (ms)

### TERMINATION\_GRACE\_MS

> **TERMINATION\_GRACE\_MS**: `number` = `500`

默认硬超时后的清理宽限期 (ms)
