[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcActiveTaskTracker

# Class: RpcActiveTaskTracker

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:174](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L174)

RpcActiveTaskTracker 负责管控挂起任务账本生命周期、ID 唯一性校验与全局心跳 (TTL) 扫描

## Constructors

### Constructor

> **new RpcActiveTaskTracker**(`ttlMs?`): `RpcActiveTaskTracker`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:181](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L181)

#### Parameters

##### ttlMs?

`number` = `...`

默认 5 分钟 (300000ms)，超过此时间未被查询的心跳将被干掉。

#### Returns

`RpcActiveTaskTracker`

## Properties

### ttlMs

> `readonly` **ttlMs**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:181](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L181)

默认 5 分钟 (300000ms)，超过此时间未被查询的心跳将被干掉。

## Methods

### add()

> **add**(`requestId`, `handle`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:188](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L188)

登记新任务。包含 Request ID 唯一性校验。

#### Parameters

##### requestId

`string`

##### handle

[`RpcActiveTaskHandle`](RpcActiveTaskHandle.md)

#### Returns

`void`

***

### get()

> **get**(`requestId`): [`RpcActiveTaskHandle`](RpcActiveTaskHandle.md) \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:196](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L196)

#### Parameters

##### requestId

`string`

#### Returns

[`RpcActiveTaskHandle`](RpcActiveTaskHandle.md) \| `undefined`

***

### remove()

> **remove**(`requestId`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:204](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L204)

#### Parameters

##### requestId

`string`

#### Returns

`void`

***

### stop()

> **stop**(): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:226](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L226)

#### Returns

`void`
