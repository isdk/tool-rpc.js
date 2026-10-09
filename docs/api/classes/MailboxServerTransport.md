[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / MailboxServerTransport

# Class: MailboxServerTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:13](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L13)

所有传输协议 (Client/Server) 统一的基础能力接口。

## Extends

- [`ServerToolTransport`](ServerToolTransport.md)

## Constructors

### Constructor

> **new MailboxServerTransport**(`options?`): `MailboxServerTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:24](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L24)

#### Parameters

##### options?

[`MailboxServerTransportOptions`](../interfaces/MailboxServerTransportOptions.md) = `{}`

#### Returns

`MailboxServerTransport`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`constructor`](ServerToolTransport.md#constructor)

## Properties

### apiPrefix

> `protected` **apiPrefix**: `string` = `'/'`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:16](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L16)

***

### apiUrl

> **apiUrl**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:90](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L90)

调用的基准 API 地点（URI）
必须能够支持处理如 scheme, hostname, port, 乃至 auth (user:pass)。
对于扁平协议，不必支持 path 路由（具体通过 header 进行）。

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`apiUrl`](ServerToolTransport.md#apiurl)

***

### bindBaseUrl?

> `protected` `optional` **bindBaseUrl?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:150](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L150)

显式 bind 参数改写后的声明身份；未显式指定时 undefined（沿用 apiUrl 派生值）。
每次 start() 都重新计算，不累加：上一轮的 bind 参数不应泄漏到下一轮。

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`bindBaseUrl`](ServerToolTransport.md#bindbaseurl)

***

### canStream

> **canStream**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:93](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L93)

是否支持原生的流式传输 (如 HTTP 支持, Mailbox 通常不支持)

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`canStream`](ServerToolTransport.md#canstream)

***

### discoveryHandlerInfo

> `protected` **discoveryHandlerInfo**: \{ `handler`: () => `any`; `prefix`: `string`; \} \| `null` = `null`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:17](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L17)

***

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:92](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L92)

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`dispatcher`](ServerToolTransport.md#dispatcher)

***

### isInternalMailbox

> `protected` **isInternalMailbox**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:22](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L22)

***

### isRunning

> `protected` **isRunning**: `boolean` = `false`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:21](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L21)

***

### listenAddress

> `protected` **listenAddress**: `string` = `''`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:15](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L15)

***

### mailbox

> `protected` **mailbox**: `Mailbox`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:14](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L14)

***

### manager

> **manager**: `RpcClientTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L57)

所属管理器引用

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`manager`](ServerToolTransport.md#manager)

***

### mode

> `protected` **mode**: `"push"` \| `"pull"` = `'push'`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:19](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L19)

***

### options?

> `optional` **options?**: [`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:91](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L91)

具体协议额外的配置或选项扩展

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`options`](ServerToolTransport.md#options)

***

### pullInterval

> `protected` **pullInterval**: `number` = `1000`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:20](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L20)

***

### routeClaims

> `protected` **routeClaims**: `Map`\<`string`, [`RouteClaim`](../interfaces/RouteClaim.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:260](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L260)

prefix -> 逻辑路由声明。多前缀 / 多注册表共用同一份簿记。

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`routeClaims`](ServerToolTransport.md#routeclaims)

***

### subscription

> `protected` **subscription**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:18](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L18)

## Methods

### \_start()

> **\_start**(`options?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:197](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L197)

#### Parameters

##### options?

`any`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`_start`](ServerToolTransport.md#_start)

***

### addDiscoveryHandler()

> **addDiscoveryHandler**(`apiUrl`, `handler`, `options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:77](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L77)

#### Parameters

##### apiUrl

`string`

##### handler

() => `any`

##### options?

[`RouteClaimOptions`](../interfaces/RouteClaimOptions.md)

#### Returns

`void`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`addDiscoveryHandler`](ServerToolTransport.md#adddiscoveryhandler)

***

### addRpcHandler()

> **addRpcHandler**(`apiUrl`, `options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:84](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L84)

#### Parameters

##### apiUrl

`string`

##### options?

[`RouteClaimOptions`](../interfaces/RouteClaimOptions.md)

#### Returns

`void`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`addRpcHandler`](ServerToolTransport.md#addrpchandler)

***

### apiUrlIdentity()

> `protected` **apiUrlIdentity**(): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:142](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L142)

仅由 apiUrl 派生的声明身份（默认归一化 apiUrl：去 path、回环/通配 host 归一）。
无 URL 表示的 transport 覆写本方法自行构造 URI（`unix:/run/ai.sock`、`mem://bus-a`）。

#### Returns

`string`

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`apiUrlIdentity`](ServerToolTransport.md#apiurlidentity)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`applyBindOptions`](ServerToolTransport.md#applybindoptions)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`claimRoute`](ServerToolTransport.md#claimroute)

***

### defaultBindOptions()

> `protected` **defaultBindOptions**(): [`BindOptions`](../interfaces/BindOptions.md) \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:171](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L171)

本 transport 确定的默认监听参数（写进声明身份用）。默认无：基类没有物理
监听概念，也不得猜。有真实监听的 transport 请只在这里放**与 _start 一致**的值。

#### Returns

[`BindOptions`](../interfaces/BindOptions.md) \| `undefined`

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`defaultBindOptions`](ServerToolTransport.md#defaultbindoptions)

***

### drainBacklog()

> `protected` **drainBacklog**(`address`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:214](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L214)

#### Parameters

##### address

`string`

#### Returns

`Promise`\<`void`\>

***

### extractPath()

> `protected` **extractPath**(`urlStr`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:49](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L49)

注意：与基类 toPathname 不同，这里要求 urlStr 是完整 URL，
解析失败一律退回 '/'（既有语义，测试依赖）。

#### Parameters

##### urlStr

`string`

#### Returns

`string`

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`getBaseUrl`](ServerToolTransport.md#getbaseurl)

***

### getBoundAddress()

> **getBoundAddress**(): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:179](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L179)

实际绑定观测。基类无物理监听概念，默认 undefined；
有真实 socket 的协议覆写（参见 HttpServerToolTransport）。

#### Returns

`string` \| `undefined`

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`getBoundAddress`](ServerToolTransport.md#getboundaddress)

***

### ~~getListenAddr()~~

> **getListenAddr**(): `string` \| `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:187](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L187)

#### Returns

`string` \| `string`[]

#### Deprecated

改用 getBaseUrl()。本名语义含糊（容易被读成“监听之后拿到的地址”），
它实际返回的是声明身份；绑定观测请用 getBoundAddress()。

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`getListenAddr`](ServerToolTransport.md#getlistenaddr)

***

### getRaw()

> **getRaw**(): `Mailbox`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:253](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L253)

#### Returns

`Mailbox`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getRaw`](ServerToolTransport.md#getraw)

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:73](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L73)

Mailbox 默认接管全量路径：这是设计文档规定的独占保护（同一 mailbox 地址
只允许一个服务端实例），不能因为声明了具体前缀就缩小成该前缀。

#### Returns

`string`[]

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getRoutes`](ServerToolTransport.md#getroutes)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`onDuplicateRoute`](ServerToolTransport.md#onduplicateroute)

***

### onReceive()

> `protected` **onReceive**(`message`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:89](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L89)

#### Parameters

##### message

`MailMessage`

#### Returns

`Promise`\<`void`\>

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`processIncomingCall`](ServerToolTransport.md#processincomingcall)

***

### resolvedBaseUrl()

> `protected` **resolvedBaseUrl**(): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:134](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L134)

声明身份的实际计算：apiUrl 派生值 + 显式 bind 改写。
覆写 getBaseUrl() 的子类（如 HTTP，需要收窄成 string）请复用它，
免得漏掉 bind 改写。

#### Returns

`string`

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`resolvedBaseUrl`](ServerToolTransport.md#resolvedbaseurl)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`routeApiUrl`](ServerToolTransport.md#routeapiurl)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`routeDiscoveryHandler`](ServerToolTransport.md#routediscoveryhandler)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`routeRegistry`](ServerToolTransport.md#routeregistry)

***

### runPullLoop()

> `protected` **runPullLoop**(`address`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:224](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L224)

#### Parameters

##### address

`string`

#### Returns

`Promise`\<`void`\>

***

### sendRpcResponse()

> `protected` **sendRpcResponse**(`rpcRes`, `rawRes`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:163](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L163)

#### Parameters

##### rpcRes

[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)

##### rawRes

`MailMessage`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`sendRpcResponse`](ServerToolTransport.md#sendrpcresponse)

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

[`ServerToolTransport`](ServerToolTransport.md).[`setApiUrl`](ServerToolTransport.md#setapiurl)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`start`](ServerToolTransport.md#start)

***

### stop()

> **stop**(`force?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:242](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L242)

停止物理监听

#### Parameters

##### force?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`stop`](ServerToolTransport.md#stop)

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

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`toMatchPrefix`](ServerToolTransport.md#tomatchprefix)

***

### toPathname()

> `protected` **toPathname**(`apiUrl`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:65](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L65)

Mailbox 的 apiUrl 是地址而不是 http URL，沿用 extractPath 的解析结果，
再归一为基类的 canonical 形式（无尾斜杠），避免 claim key 里混入 scheme。

#### Parameters

##### apiUrl

`string`

#### Returns

`string`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`toPathname`](ServerToolTransport.md#topathname)

***

### toRpcRequest()

> `protected` **toRpcRequest**(`rawReq`): `Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/mailbox-server.ts:114](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/mailbox-server.ts#L114)

#### Parameters

##### rawReq

`MailMessage`

#### Returns

`Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`toRpcRequest`](ServerToolTransport.md#torpcrequest)
