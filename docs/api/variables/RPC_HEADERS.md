[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RPC\_HEADERS

# Variable: RPC\_HEADERS

> `const` **RPC\_HEADERS**: `object`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:6](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L6)

标准 Header 定义。

## Type Declaration

### ACT

> **ACT**: `string` = `'rpc-act'`

(可选) 动作或子方法

### CLIENT\_ID

> **CLIENT\_ID**: `string` = `'rpc-client-id'`

客户端标识 (用于 session 识别)

### ~~FUNC~~

> **FUNC**: `string` = `'rpc-fn'`

#### Deprecated

use TOOL_ID instead

### REQUEST\_ID

> **REQUEST\_ID**: `string` = `'req-id'`

请求唯一 ID (由客户端生成或传输层补齐，且必须在响应中回显)

### RES\_ID

> **RES\_ID**: `string` = `'rpc-res-id'`

(可选) 资源唯一标识 (Resource ID)

### RETRY\_AFTER

> **RETRY\_AFTER**: `string` = `'rpc-retry-after'`

任务退避/轮询间隔参考 (ms)

### TIMEOUT

> **TIMEOUT**: `string` = `'rpc-timeout'`

业务执行超时声明 (ms)

### TOOL\_ID

> **TOOL\_ID**: `string` = `'rpc-fn'`

工具/函数标识

### TRACE\_ID

> **TRACE\_ID**: `string` = `'trace-id'`

链路追踪 ID
