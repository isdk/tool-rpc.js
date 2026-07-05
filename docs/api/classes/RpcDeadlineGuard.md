[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcDeadlineGuard

# Class: RpcDeadlineGuard

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:14](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L14)

## File

双级死线控制器 (RpcDeadlineGuard)
统一管控服务端响应超时 (102) 与硬执行死线 (408/Signal Abort)

## Constructors

### Constructor

> **new RpcDeadlineGuard**(`timeoutMs`, `hooks?`, `hardTimeoutMs?`, `terminationGraceMs?`): `RpcDeadlineGuard`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:21](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L21)

#### Parameters

##### timeoutMs

`number`

##### hooks?

[`RpcDeadlineHooks`](../interfaces/RpcDeadlineHooks.md) = `{}`

##### hardTimeoutMs?

`number`

硬超时绝对值，若不提供则不开启硬超时处理

##### terminationGraceMs?

`number` = `RPC_DEFAULTS.TERMINATION_GRACE_MS`

硬超时触发后报错延迟 (ms)

#### Returns

`RpcDeadlineGuard`

## Methods

### cancel()

> **cancel**(): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:75](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L75)

正常结束时清理所有定时器

#### Returns

`void`

***

### getPromise()

> **getPromise**(): `Promise`\<`never`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:68](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L68)

提供给外部进行 race 的原始 Promise

#### Returns

`Promise`\<`never`\>

***

### start()

> **start**(): `Promise`\<`never`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/deadline-guard.ts:37](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/deadline-guard.ts#L37)

启动看门狗并返回可竞争的 Promise。

#### Returns

`Promise`\<`never`\>
