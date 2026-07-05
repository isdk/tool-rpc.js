[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ToolRpcResponse

# Interface: ToolRpcResponse

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:115](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L115)

调度层向传输层的归一化结果对象

## Properties

### data?

> `optional` **data?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:118](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L118)

***

### error?

> `optional` **error?**: `object`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:120](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L120)

#### code

> **code**: `number`

业务错误码 (对应 HTTP 错误码)

#### data?

> `optional` **data?**: `any`

#### message

> **message**: `string`

#### stack?

> `optional` **stack?**: `string`

#### status?

> `optional` **status?**: `string`

状态标识字符串 (可选，如 'not_found', 'missing_params')

***

### headers?

> `optional` **headers?**: `Record`\<`string`, `string` \| `number` \| `string`[] \| `undefined`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:119](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L119)

***

### raw?

> `optional` **raw?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:129](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L129)

***

### status

> **status**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:117](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L117)

响应状态码 (物理协议映射值，如 200, 404, 500)
