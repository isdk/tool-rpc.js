[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / RpcServerDispatcher

# Class: RpcServerDispatcher

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:23](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L23)

集中式 RPC 请求分发器。
负责将标准化的 ToolRpcRequest 路由到注册表中的工具函数。

## Constructors

### Constructor

> **new RpcServerDispatcher**(`options?`): `RpcServerDispatcher`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:40](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L40)

#### Parameters

##### options?

###### compat?

`RpcCompatOptions`

###### globalTimeout?

`number`

###### maxTaskRuntimeMs?

`number`

###### registry?

`any`

###### terminationGraceMs?

`number`

###### tracker?

[`RpcActiveTaskTracker`](RpcActiveTaskTracker.md)

#### Returns

`RpcServerDispatcher`

## Properties

### compat

> **compat**: `RpcCompatOptions` = `DEFAULT_COMPAT_OPTIONS`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:34](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L34)

兼容性配置

***

### globalTimeout

> **globalTimeout**: `number` = `30000`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:32](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L32)

默认全局超时时间 (ms)

***

### maxTaskRuntimeMs

> **maxTaskRuntimeMs**: `number` = `3600000`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:38](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L38)

全局任务执行硬死线 (ms)，防止后台任务永久运行。默认 1 小时

***

### registry

> **registry**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:26](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L26)

工具/函数注册表，通常挂载 ServerTools

***

### terminationGraceMs

> **terminationGraceMs**: `number` = `RPC_DEFAULTS.TERMINATION_GRACE_MS`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:36](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L36)

硬超时后的清理宽限期 (ms)

***

### tracker

> **tracker**: [`RpcActiveTaskTracker`](RpcActiveTaskTracker.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:30](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L30)

活动任务跟踪器，用于长任务状态管理

## Accessors

### instance

#### Get Signature

> **get** `static` **instance**(): `RpcServerDispatcher`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:59](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L59)

##### Returns

`RpcServerDispatcher`

## Methods

### dispatch()

> **dispatch**(`request`, `registry?`): `Promise`\<[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:69](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L69)

分发请求。

#### Parameters

##### request

[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)

归一化的 RPC 请求对象

##### registry?

`any`

可选的替代注册表 (用于多路由挂载场景)

#### Returns

`Promise`\<[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)\>

***

### handleError()

> **handleError**(`request`, `err`): [`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/dispatcher.ts:308](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/dispatcher.ts#L308)

#### Parameters

##### request

[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)

##### err

`any`

#### Returns

[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)
