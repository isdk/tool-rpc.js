[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcActiveTaskHandle

# Class: RpcActiveTaskHandle

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:13](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L13)

RpcActiveTaskHandle 负责单个活动任务的执行状态记录、结果缓存与清理策略判定

## Constructors

### Constructor

> **new RpcActiveTaskHandle**(`requestId`, `promise`, `aborter`, `isStream`, `onCleanup`, `retention?`, `maxRuntimeMs?`): `RpcActiveTaskHandle`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:35](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L35)

#### Parameters

##### requestId

`string`

##### promise

`Promise`\<`any`\>

##### aborter

`AbortController`

##### isStream

`boolean`

##### onCleanup

() => `void`

##### retention?

[`RpcTaskRetention`](../type-aliases/RpcTaskRetention.md)

##### maxRuntimeMs?

`number`

#### Returns

`RpcActiveTaskHandle`

## Properties

### aborter

> `readonly` **aborter**: `AbortController`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:38](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L38)

***

### completedAt?

> `optional` **completedAt?**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:19](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L19)

任务完成时间戳

***

### error?

> `optional` **error?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:23](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L23)

任务错误对象

***

### fetchCount

> **fetchCount**: `number` = `0`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:25](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L25)

任务被成功获取 (GET) 的次数

***

### isStream

> `readonly` **isStream**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:39](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L39)

***

### lastAccessed

> **lastAccessed**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:15](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L15)

最后一次被外部 (如心跳或状态查询) 访问的时间戳

***

### onCleanup

> `readonly` **onCleanup**: () => `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:40](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L40)

#### Returns

`void`

***

### promise

> `readonly` **promise**: `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:37](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L37)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:36](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L36)

***

### result?

> `optional` **result?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:21](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L21)

任务结果数据

***

### retention

> **retention**: [`RpcTaskRetentionConfig`](../interfaces/RpcTaskRetentionConfig.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:27](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L27)

任务保留策略

***

### status

> **status**: `"processing"` \| `"completed"` \| `"error"` \| `"aborted"` = `'processing'`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:17](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L17)

任务执行状态

***

### streamPending

> **streamPending**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:29](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L29)

[流式专用] 标记流是否仍在传输中

## Methods

### abort()

> **abort**(`reason?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:133](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L133)

主动中止任务

#### Parameters

##### reason?

`any`

#### Returns

`void`

***

### markStreamFinished()

> **markStreamFinished**(): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:96](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L96)

#### Returns

`void`

***

### setOutputStream()

> **setOutputStream**(`stream`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:91](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L91)

#### Parameters

##### stream

`ReadableStream`

#### Returns

`void`

***

### shouldCleanup()

> **shouldCleanup**(`now`): `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:143](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L143)

判定当前任务是否符合清理条件

#### Parameters

##### now

`number`

当前时间戳 (由 Tracker 统一传入)

#### Returns

`boolean`

***

### touch()

> **touch**(): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/task-tracker.ts:128](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/task-tracker.ts#L128)

刷新心跳 TTL

#### Returns

`void`
