[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ClientFuncItem

# Interface: ClientFuncItem

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/client-tools.ts:25](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/client-tools.ts#L25)

Alias for `RemoteFuncItem` on the client side.

## Extends

- [`RemoteFuncItem`](RemoteFuncItem.md)

## Extended by

- [`ClientTools`](../classes/ClientTools.md)

## Properties

### action?

> `optional` **action?**: `"get"` \| `"post"` \| `"put"` \| `"delete"` \| `"patch"` \| `"list"` \| `"res"`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/consts.ts:72](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/consts.ts#L72)

The action to be used for the remote call. This typically represents an RPC method name.
Only for RESTful HTTP transports, it might be mapped to a standard HTTP method (e.g., GET, POST)

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`action`](RemoteFuncItem.md#action)

***

### alias?

> `optional` **alias?**: `string` \| `string`[]

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:418

Optional aliases for the function name.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`alias`](RemoteFuncItem.md#alias)

***

### ~~apiRoot?~~

> `optional` **apiRoot?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/consts.ts:66](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/consts.ts#L66)

The root endpoint for the remote service.

#### Deprecated

Use `transport` instead.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`apiRoot`](RemoteFuncItem.md#apiroot)

***

### asyncFeatures?

> `optional` **asyncFeatures?**: `number`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:435

A bitmask representing asynchronous features supported by the function, built from `AsyncFeatureBits`.
This allows the system to understand if a function supports capabilities like cancellation or multi-tasking.

#### See

`AsyncFeatureBits` from `./utils/async-features`

#### Example

```ts
import { AsyncFeatures } from './utils';
const func = new ToolFunc({
  name: 'cancellableTask',
  asyncFeatures: AsyncFeatures.Cancelable | AsyncFeatures.MultiTask,
  // ...
});
```

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`asyncFeatures`](RemoteFuncItem.md#asyncfeatures)

***

### depends?

> `optional` **depends?**: `object`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:461

A map of dependencies this function has on other tool functions.
Declaring dependencies ensures that they are automatically registered when this function is registered.
This is crucial for building modular functions that rely on each other without needing to manage registration order manually.

#### Index Signature

\[`name`: `string`\]: `ToolFunc`

#### Example

```ts
const helperFunc = new ToolFunc({ name: 'helper', func: () => 'world' });
const mainFunc = new ToolFunc({
  name: 'main',
  depends: {
    helper: helperFunc,
  },
  func() {
    // We can now safely run the dependency
    const result = this.runSync('helper');
    return `Hello, ${result}`;
  }
});
// When mainFunc is registered, helperFunc will be registered automatically.
mainFunc.register();
```

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`depends`](RemoteFuncItem.md#depends)

***

### description?

> `optional` **description?**: `string`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:469

A detailed description of what the function does.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`description`](RemoteFuncItem.md#description)

***

### expectedDuration?

> `optional` **expectedDuration?**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/consts.ts:92](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/consts.ts#L92)

The expected duration of the remote call in milliseconds.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`expectedDuration`](RemoteFuncItem.md#expectedduration)

***

### fetchOptions?

> `optional` **fetchOptions?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/consts.ts:77](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/consts.ts#L77)

Addtional options to be passed to the underlying `fetch` call in a transport.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`fetchOptions`](RemoteFuncItem.md#fetchoptions)

***

### isApi?

> `optional` **isApi?**: `boolean`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:405

If true, indicates that this function should be treated as a server-side API.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`isApi`](RemoteFuncItem.md#isapi)

***

### name?

> `optional` **name?**: `string`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:249

The unique name of the function.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`name`](RemoteFuncItem.md#name)

***

### params?

> `optional` **params?**: `FuncParams` \| `FuncParam`[]

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:255

Parameter definitions, which can be an object mapping names to definitions or an array for positional parameters.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`params`](RemoteFuncItem.md#params)

***

### result?

> `optional` **result?**: `string` \| `Record`\<`string`, `any`\>

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:261

The expected return type of the function, described as a string or a JSON schema object.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`result`](RemoteFuncItem.md#result)

***

### scope?

> `optional` **scope?**: `any`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:280

The execution scope or context (`this`) for the function.

Its keys become closure variables of the func, and a `this` key becomes the func's `this`.
Because those bindings are captured while compiling, the scope is read at compile time:

- a string FuncItem.func is always compiled against it;
- a *function* value is compiled from its own source when a non-empty scope is declared — a
  source that is not a function expression (method shorthand, a class method, native code) is
  used as-is instead, since it has no standalone source to compile;
- an empty or absent scope leaves a function value untouched, so its lexical closure survives.

A [BaseFuncItem.setup](RemoteFuncItem.md#setup) hook may provide the scope too: it is applied *before* the func is
compiled (see the lifecycle ability).

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`scope`](RemoteFuncItem.md#scope)

***

### stream?

> `optional` **stream?**: `boolean`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/consts.ts:96](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/consts.ts#L96)

Whether the tool returns a stream.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`stream`](RemoteFuncItem.md#stream)

***

### tags?

> `optional` **tags?**: `string` \| `string`[]

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:286

Tags for grouping or filtering functions.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`tags`](RemoteFuncItem.md#tags)

***

### timeout?

> `optional` **timeout?**: `number` \| \{ `keepAliveOnTimeout?`: `boolean`; `streamIdleTimeout?`: `number`; `value`: `number`; \}

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/consts.ts:81](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/consts.ts#L81)

The timeout configuration for the remote call.

#### Union Members

`number`

***

##### Type Literal

\{ `keepAliveOnTimeout?`: `boolean`; `streamIdleTimeout?`: `number`; `value`: `number`; \}

##### keepAliveOnTimeout?

> `optional` **keepAliveOnTimeout?**: `boolean`

Whether to keep the server-side function running after a timeout.

##### streamIdleTimeout?

> `optional` **streamIdleTimeout?**: `number`

The idle timeout for streaming responses in milliseconds.

##### value

> **value**: `number`

The hard timeout in milliseconds.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`timeout`](RemoteFuncItem.md#timeout)

***

### title?

> `optional` **title?**: `string`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:475

A concise, human-readable title for the function, often used in UI or by AI.

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`title`](RemoteFuncItem.md#title)

## Methods

### cleanup()?

> `optional` **cleanup**(`this`): `void` \| `Promise`\<`void`\>

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:399

A lifecycle hook called once at the **end of every call**, releasing whatever *that call*
acquired. It is the call-scoped twin of [BaseFuncItem.dispose](RemoteFuncItem.md#dispose): while `dispose` is tied to
the instance's registration lifetime, `cleanup` is tied to a single `run()`.

Because the tools are executed through an isolated shadow instance, the body may park per-call
resources on `this` (`this.tx = begin()`) and `cleanup` releases exactly those — concurrent calls
cannot collide. Declaring `cleanup` is what makes that isolation automatic; no flag is needed.

It is invoked on every terminal path of the call, at most once: a synchronous result or throw, a
settled promise (resolve *and* reject), a returned `ReadableStream` (once that stream finishes,
fails or is cancelled), and an abort of the call's signal. Write it defensively (`this.tx?.rollback()`),
since a body that threw before acquiring anything still ends the call.

The hook may return a `Promise`. A synchronous entry point can only *initiate* that release (its
rejection is logged rather than thrown), while `run()`/`runWithPos()` already return a promise and
therefore resolve only after `cleanup` has settled. When both the body and `cleanup` fail, the two
errors are reported as one `AggregateError`.

NOTE: like [BaseFuncItem.setup](RemoteFuncItem.md#setup) and [BaseFuncItem.dispose](RemoteFuncItem.md#dispose), this hook is only invoked
by the `makeToolFuncLifecycle` ability. Install it once, on the registry class you actually use:
`const Tools = makeToolFuncLifecycle(ToolFunc)`.

#### Parameters

##### this

`ToolFunc`

#### Returns

`void` \| `Promise`\<`void`\>

#### Example

```ts
const Tools = makeToolFuncLifecycle(ToolFunc);
const myFunc = new Tools({
  name: 'tx',
  func() {
    this.tx = db.begin();   // acquired whenever the body needs it, conditionally if you like
    return this.tx.query('select 1');
  },
  cleanup() { return this.tx?.commit() },  // <- runs when the call ends, however it ends
});
```

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`cleanup`](RemoteFuncItem.md#cleanup)

***

### dispose()?

> `optional` **dispose**(`this`): `void` \| `Promise`\<`void`\>

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:360

A lifecycle hook called once when the `ToolFunc` instance is **removed from the registry**,
i.e. when the reference count drops to zero or when `unregister` is forced. It is the exact
inverse of [BaseFuncItem.setup](RemoteFuncItem.md#setup): releasing whatever `setup` acquired (connections,
logins, timers, subscriptions...).

The hook may return a `Promise`. Because the synchronous `unregister()` cannot await it, the
returned promise is tracked and its rejection is logged rather than thrown. Use
`unregisterAsync()` to await the teardown and observe the real error.

After a successful `dispose`, the instance is re-armed: registering it again re-runs `setup`.

NOTE: like [BaseFuncItem.setup](RemoteFuncItem.md#setup), this hook is only invoked by the `makeToolFuncLifecycle`
ability. Install it once, on the registry class you actually use:
`const Tools = makeToolFuncLifecycle(ToolFunc)`.

#### Parameters

##### this

`ToolFunc`

#### Returns

`void` \| `Promise`\<`void`\>

#### Example

```ts
const Tools = makeToolFuncLifecycle(ToolFunc);
const myFunc = new Tools({
  name: 'myFunc',
  setup() { this.conn = connect() },
  dispose() { this.conn.close() },
  func: () => 'ok',
});
myFunc.register();
myFunc.unregister(); // <- dispose runs here
```

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`dispose`](RemoteFuncItem.md#dispose)

***

### setup()?

> `optional` **setup**(`this`, `options?`): `void` \| `Promise`\<`void`\>

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:328

A lifecycle hook called once when the `ToolFunc` instance is **registered**, and again after
it has been `dispose`d and re-registered. It is the exact inverse of [BaseFuncItem.dispose](RemoteFuncItem.md#dispose).

It allows for initial setup, state configuration, or property modification on the instance.
The `this` context is the `ToolFunc` instance itself.

The hook may return a `Promise`. When it does, the instance is *pending* until that promise
settles: `run()` awaits it automatically, while `runSync()` refuses to execute and asks you to
use `run()` / `await tool.ready` instead. Use `registerAsync()` when you want registration
itself to wait for setup to finish.

NOTE: this hook is only *invoked* by the `makeToolFuncLifecycle` ability — a plain `ToolFunc`
stores it but never calls it. Install it once, on the registry class you actually use:
`const Tools = makeToolFuncLifecycle(ToolFunc)`.

Mutating `options` inside the hook still works (including after an `await`): the touched keys
are re-applied through the very same `initialize`/`assign` pipeline that built the instance.
A `scope` the hook provides — through `this.scope` or through the options object — is applied
before a string `func` is compiled, and a scope *change* rebuilds it (see
[BaseFuncItem.scope](RemoteFuncItem.md#scope)).

#### Parameters

##### this

`ToolFunc`

The `ToolFunc` instance the hook is bound to.

##### options?

`FuncItem`

The configuration options for the function.

#### Returns

`void` \| `Promise`\<`void`\>

#### Example

```ts
const Tools = makeToolFuncLifecycle(ToolFunc);
const myFunc = new Tools({
  name: 'myFunc',
  customState: 'initial',
  setup() {
    // `this` is the myFunc instance
    this.customState = 'configured';
  }
});
myFunc.register(); // <- setup runs here, not in the constructor
console.log(myFunc.customState); // Outputs: 'configured'
```

#### Inherited from

[`RemoteFuncItem`](RemoteFuncItem.md).[`setup`](RemoteFuncItem.md#setup)
