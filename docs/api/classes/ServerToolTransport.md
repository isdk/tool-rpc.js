[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ServerToolTransport

# Abstract Class: ServerToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:89](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L89)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`ToolTransport`](ToolTransport.md)

## Extended by

- [`HttpServerToolTransport`](HttpServerToolTransport.md)
- [`MailboxServerTransport`](MailboxServerTransport.md)

## Implements

- [`IServerToolTransport`](../interfaces/IServerToolTransport.md)

## Constructors

### Constructor

> **new ServerToolTransport**(`options?`): `ServerToolTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:95](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L95)

#### Parameters

##### options?

[`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

#### Returns

`ServerToolTransport`

#### Overrides

[`ToolTransport`](ToolTransport.md).[`constructor`](ToolTransport.md#constructor)

## Properties

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:90](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L90)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`apiUrl`](../interfaces/IServerToolTransport.md#apiurl)

#### Overrides

[`ToolTransport`](ToolTransport.md).[`apiUrl`](ToolTransport.md#apiurl)

***

### bindBaseUrl?

> `protected` `optional` **bindBaseUrl?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:150](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L150)

显式 bind 参数改写后的声明身份；未显式指定时 undefined（沿用 apiUrl 派生值）。
每次 start() 都重新计算，不累加：上一轮的 bind 参数不应泄漏到下一轮。

***

### canStream

> **canStream**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:93](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L93)

是否支持原生的流式传输 (如 HTTP 支持, Mailbox 通常不支持)

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`canStream`](../interfaces/IServerToolTransport.md#canstream)

***

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:92](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L92)

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`dispatcher`](../interfaces/IServerToolTransport.md#dispatcher)

***

### manager

> **manager**: `RpcClientTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L57)

所属管理器引用

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`manager`](../interfaces/IServerToolTransport.md#manager)

#### Inherited from

[`ToolTransport`](ToolTransport.md).[`manager`](ToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:91](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L91)

具体协议额外的配置或选项扩展

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`options`](../interfaces/IServerToolTransport.md#options)

#### Overrides

[`ToolTransport`](ToolTransport.md).[`options`](ToolTransport.md#options)

***

### routeClaims

> `protected` **routeClaims**: `Map`\<`string`, [`RouteClaim`](../interfaces/RouteClaim.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:260](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L260)

prefix -> 逻辑路由声明。多前缀 / 多注册表共用同一份簿记。

## Methods

### \_start()

> `abstract` **\_start**(`options?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:358](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L358)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`\>

***

### addDiscoveryHandler()

> `abstract` **addDiscoveryHandler**(`apiUrl`, `handler`, `options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:356](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L356)

#### Parameters

##### apiUrl

`string`

##### handler

() => `any`

##### options?

[`RouteClaimOptions`](../interfaces/RouteClaimOptions.md)

#### Returns

`void`

***

### addRpcHandler()

> `abstract` **addRpcHandler**(`apiUrl`, `options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:357](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L357)

#### Parameters

##### apiUrl

`string`

##### options?

[`RouteClaimOptions`](../interfaces/RouteClaimOptions.md)

#### Returns

`void`

***

### apiUrlIdentity()

> `protected` **apiUrlIdentity**(): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:142](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L142)

仅由 apiUrl 派生的声明身份（默认归一化 apiUrl：去 path、回环/通配 host 归一）。
无 URL 表示的 transport 覆写本方法自行构造 URI（`unix:/run/ai.sock`、`mem://bus-a`）。

#### Returns

`string`

***

### applyBindOptions()

> `protected` **applyBindOptions**(`options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:158](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L158)

把 `start({ host, port, path })` 这类**声明式**的 bind 参数并入声明身份。
必须在 _start 之前调用：审计与底座复用池的 key 都得在 bind 之前定下来。
只认调用方给的参数（start 入参 + options 预置）与 defaultBindOptions() 里
声明的确定默认值；其余实现细节不算声明。

#### Parameters

##### options?

[`BindOptions`](../interfaces/BindOptions.md)

#### Returns

`void`

***

### claimRoute()

> `protected` **claimRoute**(`apiUrl`, `kind`, `options?`): [`RouteClaim`](../interfaces/RouteClaim.md) \| `null`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:296](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L296)

声明一条逻辑路由，并合并 registry / discoveryHandler。

返回 claim 表示子类需要注册对应的物理路由；返回 null 表示该
(prefix, kind) 已声明过——逻辑信息已更新，物理路由无需（也不应）重复注册。

#### Parameters

##### apiUrl

`string`

##### kind

`"rpc"` \| `"discovery"`

##### options?

[`RouteClaimOptions`](../interfaces/RouteClaimOptions.md) = `{}`

#### Returns

[`RouteClaim`](../interfaces/RouteClaim.md) \| `null`

***

### defaultBindOptions()

> `protected` **defaultBindOptions**(): [`BindOptions`](../interfaces/BindOptions.md) \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:171](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L171)

本 transport 确定的默认监听参数（写进声明身份用）。默认无：基类没有物理
监听概念，也不得猜。有真实监听的 transport 请只在这里放**与 _start 一致**的值。

#### Returns

[`BindOptions`](../interfaces/BindOptions.md) \| `undefined`

***

### getBaseUrl()

> **getBaseUrl**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:115](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L115)

声明身份：物理底座的 canonical URI（见 physical-uri.ts）。
= apiUrl 派生的身份，被 `start()` 传入的显式 bind 参数改写后的结果。
只有调用方声明的 bind 会改写它，内核观测（port 0）不会，所以 key 跨 start
边界仍然稳定。无 URL 表示的 transport（unix socket、进程内总线）请覆写 apiUrlIdentity()。

#### Returns

`string` \| `string`[]

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getBaseUrl`](../interfaces/IServerToolTransport.md#getbaseurl)

***

### getBoundAddress()

> **getBoundAddress**(): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:179](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L179)

实际绑定观测。基类无物理监听概念，默认 undefined；
有真实 socket 的协议覆写（参见 HttpServerToolTransport）。

#### Returns

`string` \| `undefined`

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getBoundAddress`](../interfaces/IServerToolTransport.md#getboundaddress)

***

### ~~getListenAddr()~~

> **getListenAddr**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:187](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L187)

#### Returns

`string` \| `string`[]

#### Deprecated

改用 getBaseUrl()。本名语义含糊（容易被读成“监听之后拿到的地址”），
它实际返回的是声明身份；绑定观测请用 getBoundAddress()。

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getListenAddr`](../interfaces/IServerToolTransport.md#getlistenaddr)

***

### getRaw()?

> `optional` **getRaw**(): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:360](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L360)

#### Returns

`any`

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getRaw`](../interfaces/IServerToolTransport.md#getraw)

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:200](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L200)

该实例声明负责的逻辑路由：每个前缀一条（归一化，无尾斜杠）。
尚未声明任何路由时返回 ['/']，即接管该物理地址下的全量路径。
需要前缀匹配形式（补尾斜杠）的后端请用 toMatchPrefix()。

#### Returns

`string`[]

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`getRoutes`](../interfaces/IServerToolTransport.md#getroutes)

***

### onDuplicateRoute()

> `protected` **onDuplicateRoute**(`prefix`, `kind`): `never`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:334](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L334)

重复声明同一前缀同类路由时的钩子（remount: 'throw'）。
基类抛出通用错误；自带路由表的后端（如 Fastify/find-my-way）可覆写为
触发框架原生的重复路由错误。

#### Parameters

##### prefix

`string`

##### kind

`"rpc"` \| `"discovery"`

#### Returns

`never`

***

### processIncomingCall()

> `protected` **processIncomingCall**(`rawReq`, `rawRes`, `registry?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:214](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L214)

Template Method：处理物理请求流水线。
下层具体协议收到请求后，将其转化为内部结构，送入 Dispatcher 并写回。

#### Parameters

##### rawReq

`any`

##### rawRes

`any`

##### registry?

`any`

#### Returns

`Promise`\<`void`\>

***

### resolvedBaseUrl()

> `protected` **resolvedBaseUrl**(): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:134](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L134)

声明身份的实际计算：apiUrl 派生值 + 显式 bind 改写。
覆写 getBaseUrl() 的子类（如 HTTP，需要收窄成 string）请复用它，
免得漏掉 bind 改写。

#### Returns

`string`

***

### routeApiUrl()

> `protected` **routeApiUrl**(`prefix`): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:349](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L349)

该前缀声明时使用的 apiUrl（用于重建 ToolRpcRequest.apiUrl）。

#### Parameters

##### prefix

`string`

#### Returns

`string` \| `undefined`

***

### routeDiscoveryHandler()

> `protected` **routeDiscoveryHandler**(`prefix`): (() => `any`) \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:344](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L344)

请求期解析：该前缀的发现处理器。

#### Parameters

##### prefix

`string`

#### Returns

(() => `any`) \| `undefined`

***

### routeRegistry()

> `protected` **routeRegistry**(`prefix`): `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:339](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L339)

请求期解析：该前缀由哪个注册表服务。

#### Parameters

##### prefix

`string`

#### Returns

`any`

***

### sendRpcResponse()

> `abstract` `protected` **sendRpcResponse**(`rpcRes`, `rawRes`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:354](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L354)

#### Parameters

##### rpcRes

[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)

##### rawRes

`any`

#### Returns

`Promise`\<`void`\>

***

### setApiUrl()

> **setApiUrl**(`apiUrl`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:67](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L67)

#### Parameters

##### apiUrl

`string`

#### Returns

`void`

#### Inherited from

[`ToolTransport`](ToolTransport.md).[`setApiUrl`](ToolTransport.md#setapiurl)

***

### start()

> **start**(`options?`): `Promise`\<`any`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:204](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L204)

启动物理监听

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`any`\>

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`start`](../interfaces/IServerToolTransport.md#start)

***

### stop()

> `abstract` **stop**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:359](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L359)

停止物理监听

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IServerToolTransport`](../interfaces/IServerToolTransport.md).[`stop`](../interfaces/IServerToolTransport.md#stop)

***

### toMatchPrefix()

> `protected` **toMatchPrefix**(`prefix`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:286](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L286)

前缀匹配用的 key：补尾斜杠，避免 '/api' 误匹配 '/apix'。
仅用于匹配与物理路由表，逻辑路由（getRoutes / 审计）用归一化前缀。

#### Parameters

##### prefix

`string`

#### Returns

`string`

***

### toPathname()

> `protected` **toPathname**(`apiUrl`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:266](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L266)

apiUrl（完整 URL）或路径前缀 -> 归一化前缀（无尾斜杠，根为 '/'）。
空路径归一为 '/'，因为多数路由表拒绝空 path。

#### Parameters

##### apiUrl

`string`

#### Returns

`string`

***

### toRpcRequest()

> `abstract` `protected` **toRpcRequest**(`rawReq`, `rawRes?`): `Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:353](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L353)

#### Parameters

##### rawReq

`any`

##### rawRes?

`any`

#### Returns

`Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>
