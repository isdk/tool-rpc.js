[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / HttpServerToolTransport

# Class: HttpServerToolTransport

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:44](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L44)

HTTP 服务端传输协议。
支持在同一物理端口上通过 URL Path 挂载多个逻辑 Transport 实例。

## Extends

- [`ServerToolTransport`](ServerToolTransport.md)

## Constructors

### Constructor

> **new HttpServerToolTransport**(`options?`): `HttpServerToolTransport`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:52](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L52)

#### Parameters

##### options?

[`HttpServerToolTransportOptions`](../interfaces/HttpServerToolTransportOptions.md)

#### Returns

`HttpServerToolTransport`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`constructor`](ServerToolTransport.md#constructor)

## Properties

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

### dispatcher

> **dispatcher**: [`RpcServerDispatcher`](RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:92](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L92)

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`dispatcher`](ServerToolTransport.md#dispatcher)

***

### manager

> **manager**: `RpcClientTransportManager`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:57](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/base.ts#L57)

所属管理器引用

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`manager`](ServerToolTransport.md#manager)

***

### options?

> `optional` **options?**: [`ServerToolTransportOptions`](../interfaces/ServerToolTransportOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:91](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L91)

具体协议额外的配置或选项扩展

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`options`](ServerToolTransport.md#options)

***

### routeClaims

> `protected` **routeClaims**: `Map`\<`string`, [`RouteClaim`](../interfaces/RouteClaim.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:260](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L260)

prefix -> 逻辑路由声明。多前缀 / 多注册表共用同一份簿记。

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`routeClaims`](ServerToolTransport.md#routeclaims)

## Methods

### \_start()

> **\_start**(`options?`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:168](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L168)

启动物理监听（支持复用）

#### Parameters

##### options?

[`BindOptions`](../interfaces/BindOptions.md) = `{}`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`_start`](ServerToolTransport.md#_start)

***

### addDiscoveryHandler()

> **addDiscoveryHandler**(`apiUrl`, `handler`, `options?`): `void`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:129](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L129)

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:136](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L136)

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:72](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L72)

apiUrl 派生的声明身份：canonical 物理 URI（`http://localhost:3000` / `http://*:8080`）。
作为底座池 key 与分发 key；`start({ host, port, path })` 的显式 bind 参数
会改写它（基类 applyBindOptions），因为那才是本实例真正要占的底座。

非回环 host 记为通配：不显式指定 host 时，本 transport 对非回环 host 一律监听
0.0.0.0（监听不属于本机的主机名会 EADDRNOTAVAIL），它占的底座就是 `*:port`。
因此 `http://a.example:8080` 与 `http://b.example:8080` 仍是同一个底座，
与实测的 bind 行为一致（而不是丢掉 host 信息：它本来就没绑定那个 host）。
显式指定 host 时不走这条规则：绑哪个就是哪个，见 withBindOptions。

#### Returns

`string`

#### Overrides

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

> `protected` **defaultBindOptions**(): [`BindOptions`](../interfaces/BindOptions.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:92](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L92)

`_start()` 在调用方未声明时的监听默认值（必须与那里一致）。apiUrl 是裸 path
前缀时，它决定了能不能造出底座 URI：否则 `http://h:3000` 与 `/api`（也监听
3000）会各自建一个 server，第二个必 EADDRINUSE。

#### Returns

[`BindOptions`](../interfaces/BindOptions.md)

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`defaultBindOptions`](ServerToolTransport.md#defaultbindoptions)

***

### getBaseUrl()

> **getBaseUrl**(): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:83](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L83)

声明身份（本 transport 只有一个底座，所以这里收窄成 string）。
池 key、分发 key、审计 key 均取此值，bind 改写由基类 resolvedBaseUrl() 提供。

#### Returns

`string`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getBaseUrl`](ServerToolTransport.md#getbaseurl)

***

### getBoundAddress()

> **getBoundAddress**(): `string` \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:100](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L100)

实际绑定观测：取自已复用/已监听的 http.Server。
未 start 时返回 undefined；port 0 时它才是真实端口。

#### Returns

`string` \| `undefined`

#### Overrides

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

> **getRaw**(): `Server`\<*typeof* `IncomingMessage`, *typeof* `ServerResponse`\> \| `undefined`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:488](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L488)

#### Returns

`Server`\<*typeof* `IncomingMessage`, *typeof* `ServerResponse`\> \| `undefined`

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`getRaw`](ServerToolTransport.md#getraw)

***

### getRoutes()

> **getRoutes**(): `string`[]

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:200](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L200)

该实例声明负责的逻辑路由：每个前缀一条（归一化，无尾斜杠）。
尚未声明任何路由时返回 ['/']，即接管该物理地址下的全量路径。
需要前缀匹配形式（补尾斜杠）的后端请用 toMatchPrefix()。

#### Returns

`string`[]

#### Inherited from

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

### sendRpcResponse()

> `protected` **sendRpcResponse**(`rpcRes`, `rawRes`): `Promise`\<`void`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:421](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L421)

#### Parameters

##### rpcRes

[`ToolRpcResponse`](../interfaces/ToolRpcResponse.md)

##### rawRes

`ServerResponse`

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:227](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L227)

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

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:266](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/server.ts#L266)

apiUrl（完整 URL）或路径前缀 -> 归一化前缀（无尾斜杠，根为 '/'）。
空路径归一为 '/'，因为多数路由表拒绝空 path。

#### Parameters

##### apiUrl

`string`

#### Returns

`string`

#### Inherited from

[`ServerToolTransport`](ServerToolTransport.md).[`toPathname`](ServerToolTransport.md#topathname)

***

### toRpcRequest()

> `protected` **toRpcRequest**(`rawReq`, `rawRes?`): `Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:346](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/http-server.ts#L346)

#### Parameters

##### rawReq

`IncomingMessage`

##### rawRes?

`ServerResponse`\<`IncomingMessage`\>

#### Returns

`Promise`\<[`ToolRpcRequest`](../interfaces/ToolRpcRequest.md)\>

#### Overrides

[`ServerToolTransport`](ServerToolTransport.md).[`toRpcRequest`](ServerToolTransport.md#torpcrequest)
