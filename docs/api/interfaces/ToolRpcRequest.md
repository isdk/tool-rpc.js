[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ToolRpcRequest

# Interface: ToolRpcRequest

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:89](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L89)

传输层到调度层的归一化 RPC 请求封包

## Properties

### act?

> `optional` **act?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:95](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L95)

(可选) 动作

***

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:91](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L91)

完整的寻址路径

***

### clientId?

> `optional` **clientId?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:101](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L101)

客户端标识 (可选，用于 session 识别)

***

### headers

> **headers**: `Record`\<`string`, `string` \| `number` \| `string`[] \| `undefined`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:107](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L107)

全量归一化 Header

***

### params

> **params**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:105](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L105)

已解构的业务参数负载

***

### raw?

> `optional` **raw?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:109](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L109)

逃生口

***

### requestId

> **requestId**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:103](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L103)

本次请求唯一标识

***

### resId?

> `optional` **resId?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:97](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L97)

(可选) 资源 ID

***

### toolId

> **toolId**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:93](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L93)

工具/函数标识名

***

### traceId?

> `optional` **traceId?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:99](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L99)

追踪 ID
