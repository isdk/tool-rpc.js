[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcDeadlineHooks

# Interface: RpcDeadlineHooks

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:3](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L3)

## Properties

### onHardDeadline?

> `optional` **onHardDeadline?**: (`reason`) => `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:7](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L7)

当 Hard Deadline (408) 触及时触发

#### Parameters

##### reason

[`RpcError`](../classes/RpcError.md)

#### Returns

`void`

***

### onResponseTimeout?

> `optional` **onResponseTimeout?**: () => `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:5](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L5)

当 Soft Deadline (102) 触及时触发

#### Returns

`void`
