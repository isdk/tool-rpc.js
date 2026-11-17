# @isdk/tool-rpc Timeout Specification (Specification v1.0)

> This file mirrors [`tool-rpc-timeout-spec.cn.md`](./tool-rpc-timeout-spec.cn.md) section by section. Keep the two
> in sync: the Chinese file is the one the implementation notes were written against, this one is the entry point for
> readers who do not read Chinese. Section numbers are identical on purpose, so `§5.2.2` means the same rule in both.

## 1. Core Definitions

### 1.1 Timeout types

- **Hard timeout (Timeout / worst case)**: the deadline after which the task is force-terminated and its resources
  released. This is the floor the system guarantees.
- **Expected duration**: the statistically average time a tool takes when it runs normally (not an enforcing
  constraint). It exists to improve perceived UX and to let the client schedule smarter.

### 1.2 Timeout configuration shape

The `timeout` property in tool metadata accepts:

- **Short form (number)**: milliseconds, the hard timeout.
- **Long form (object)**:
  - `value: number`: hard timeout in milliseconds.
  - `streamIdleTimeout?: number`: idle window for streaming responses (TTFB or chunk gap, in ms).
  - `keepAliveOnTimeout?: boolean`: whether the server may keep running the task in the background after the timeout
    (default `false`).

---

## 2. Metadata schema

`RemoteFuncItem` gains these fields:

```typescript
export interface RemoteFuncItem extends BaseFuncItem {
  /**
   * Timeout configuration: a hard timeout, or a fine-grained control object
   */
  timeout?:
    | number
    | {
        value: number
        streamIdleTimeout?: number
        keepAliveOnTimeout?: boolean
      }

  /**
   * Expected duration: the statistically normal execution time (ms).
   * Used for client-side UX and scheduling.
   */
  expectedDuration?: number
}
```

---

## 3. Using `expectedDuration` (UX & strategy)

`expectedDuration` is never enforcing, but clients are expected to use it:

### 3.1 Progress bars and loading animations

- **Non-linear progress simulation**:
  - A client may simulate progress from `expectedDuration`.
  - **Strategy**: over `0 … expectedDuration` the bar grows smoothly to 80-90%; if the call exceeds that without
    returning, the bar switches to "crawling" or "pulse" mode until `timeout.value` is hit.
- **Status messaging**:
  - If `expectedDuration > 5000` ms, the UI may say something like "working on it — this usually takes about X
    seconds…".

### 3.2 Optimistic retries and redundant requests

- For **idempotent** tools:
  - If execution exceeds `expectedDuration * 1.5` while still far from `timeout`, the client may fire a concurrent
    redundant (hedged) request to defend against transient network jitter or a single stalled server instance.

### 3.3 Client-side warm-up

- A client may use `expectedDuration` to decide whether to run other background work while waiting (prefetching the
  next resources, …) so the long call feels shorter.

---

## 4. Execution and priority logic

### 4.1 Priority negotiation (current implementation)

The deadline is negotiated in **two stages** — it is not a four-way `min`:

1. **Client** (`ClientToolTransport.fetch()`): takes the **smaller** of "the `timeout` passed at the call site" and
   "the tool metadata `timeout`"; if only one exists, that one is used. Same for `streamIdleTimeout`. The result goes
   out in the `rpc-timeout` header.
2. **Server** (`RpcServerDispatcher.prepareContext()`): takes the first value that **is configured**, in priority
   order: `header value → tool metadata timeout → dispatcher.globalTimeout` (default 30000 ms). Note this is a
   **priority fallback**, not a `min`: if the header is present it is adopted as-is (it is already the client's min).

#### What `0` means: an explicitly unbounded call

At every level, `0` is an **explicit declaration**, distinct from `undefined` (not configured):

| Written as | Meaning |
| :--- | :--- |
| `timeout: undefined` | Inherits the next level, eventually landing on `globalTimeout`. |
| `timeout: 0` | **No deadline**: `globalTimeout` does not apply either. |
| `timeout: { value: 0 }` | Same (long form). |
| `rpc-timeout: 0` (header) | The client explicitly declares no deadline; the server must not fall back to `globalTimeout`. |
| `globalTimeout: 0` | The dispatcher sets no global backstop. |

The implementation is just `readTimeoutHeader()` + `firstConfigured()`: only `undefined` / an unreadable header counts
as "not configured". It used to read `clientTimeout || toolTimeoutObj.value || this.globalTimeout`, where
`0 || x === x` — so an explicit `timeout: 0` was silently replaced by an implicit `globalTimeout`, contradicting both
`RpcDeadlineGuard` (which only arms on `> 0`) and the "0 = no deadline" comment. The built-in discovery endpoint
`rpcApis` therefore no longer declares `timeout: 0` (that value used to be a no-op; now that it works, discovery calls
would hang forever): **discovery calls are meant to be covered by the global timeout.** A tool that genuinely must not
be interrupted declares `timeout: 0` itself.

Two global guardrails exist that ignore tool metadata entirely: `dispatcher.globalTimeout` (the backstop hard timeout)
and `dispatcher.maxTaskRuntimeMs` (default 1 hour, the absolute runtime ceiling for background tasks).

### 4.2 Transport protocol conventions

- **Standard headers (V2)** (fully defined as `RPC_HEADERS` in `src/transports/models.ts`):
  - `rpc-timeout`: the final wait time the client settled on (ms).
  - `req-id`: the unique id of this call (**not** `rpc-request-id`). Used for status polling after a 102; the response
    must echo it.
  - `trace-id`: end-to-end trace id (**not** `rpc-trace-id`), for correlating logs across services.
  - `rpc-fn` / `rpc-act` / `rpc-res-id`: tool id / action / resource id.
  - `rpc-retry-after`: polling backoff advertised in a 102 response (default `RPC_DEFAULTS.RETRY_AFTER_MS` = 1000 ms).
  - `rpc-client-id`: the client's self-reported identity.
- **Status codes (V2)**:
  - **102 Processing**: **the soft deadline fired**. The server's response window expired, but the task moved to the
    background and keeps running. The client must poll per the `Retry-After` header.
  - **408 Terminated**: **the hard deadline fired**. The task ran past the physical ceiling the server set (e.g.
    `maxTaskRuntimeMs`) and was force-terminated.
    **Keep the two paths apart**: in a synchronous call the hard deadline gets remapped by `handleError()` to **504**
    (`status: 'timeout'`); 408 only appears on the **polling path** (`rpcTask.get` reading an `aborted` task) and on the
    ledger's internal `RpcError`.
    A 408 read on the polling path must be returned **as-is**: it is already the task's terminal state, and the client
    needs it to tell "was terminated" apart from "the server didn't answer in time" (§5.2.2).
    **Deployment note**: HTTP 408 means semantically "the client may retry verbatim". When the endpoint sits behind a
    public proxy / gateway, either make sure it does not retry 408 on its own, or move the "is this replayable?"
    question into the payload's business state — do not carry that meaning in the HTTP status alone; the server
    emitting 408 does not mean the request may be replayed.
  - **409 Conflict**: `requestId` conflict — a task with that id is already active in the ledger.
  - **504 Gateway Timeout**: the client's wait timed out and the task has no background-keepalive capability.
  - **Error payload**: the standard response object `{ status: 504, error: { code: 504, message: 'TIMEOUT', ... } }`.
- **Reserved act name**: `$cancel` belongs to the protocol (in the implementation it is the constant
  `RPC_SPECIAL_ACTIONS.CANCEL`, exported from the package entry). It is not part of a tool name: naming a tool method
  `$cancel` means taking over the cancellation endpoint. This act and the identically named method on the ledger
  endpoint are a pair — renaming one means renaming both.

---

## 5. Cleanup and signals

### 5.1 AbortSignal injection

- **Server side**: `params` passed to `ServerTools.run(params)` must carry `_signal: AbortSignal`. Business code can
  also reach it as `this.ctx.signal`.
- **Reserved names**: the keys the framework reads and writes on `params` (`_req` / `_res` / `_signal`; in the
  implementation `RPC_PARAM_KEYS`) are reserved: they are read-only, and the framework never overwrites a key the
  business parameters already set. On the client side `params.aborter` is reserved for the same reason (tool-func hangs
  the local task handle on it): using it as a business parameter is rejected up front, and it never goes on the wire.
  **This RPC client path does not accept `params.aborter` — not even a native `AbortController`**: to tie your own
  cancellation in, attach the signal to the call — `run(params, { signal })` (i.e. `fetchOptions.signal`). It aborts
  this request and, once the task is in the ledger, triggers `$cancel` (§5.2). tool-func's **local call path** (not
  going through RPC) still supports passing an external `AbortController` via `params.aborter` (see
  `src/utils/cancelable-ability.cn.md` in `@isdk/tool-func`). RPC closes that door here because
  `makeClientToolRpcCancelable` claims this key for its own handle: two handles on the same `params` object leaves "who
  wins" without an answer.
- **Behaviour**: when the transport fires a timeout (or the client disconnects) and `keepAliveOnTimeout` is `false`,
  that signal is triggered (`abort`). Long-running work inside the tool function should listen for it and stop (stop AI
  generation, interrupt a DB query, …).

### 5.2 Physical vs logical abort (V2)

- **Physical abort**: when the physical link drops (TCP reset, …), the server-side `HttpServerToolTransport` listens
  for `close` on `rawRes`, fetches the ledger handle via `dispatcher.tracker.get(requestId)` and calls
  `handle.abort('Physical connection closed')` (internally `aborter.abort(reason)`, which surfaces on `ctx.signal`),
  aborting the associated local task.
- **Logical abort**:
  - **Client-side cancellation**: when the user triggers an `AbortSignal` on the client:
    1. The transport immediately tries to cut the physical connection.
    2. As soon as the task is **in the ledger**, the transport must send `POST /rpcTask/:requestId?act=$cancel` to the
       server. **The test is "registered in the ledger", not "once received a 102"**: the ledger entry is created the
       moment `dispatch` starts, so a pre-102 cancel (the call is still in flight) must reach the server too — and
       physical disconnects cannot cover for this: HTTP's `rawRes.close` only covers some branches, and mailbox has no
       notion of a disconnect at all.
    3. **The cancel notification must not reuse the call's own `signal` or `timeout`.** The listener runs _after_ the
       caller's signal has already aborted, so reusing it means sending a request with an already-aborted signal (HTTP
       wires it straight into the request, mailbox rejects outright) while the outer `.catch(() => {})` swallows the
       rejection — the server learns nothing and the background task keeps running. Moving to the background also means
       the call's soft deadline has already expired, so this notification must not gamble a network round trip on a
       stale deadline. The notification therefore prepares its own options: no `signal`, no `timeout`, back to the
       transport's defaults.
  - **Server-side response**: on receiving a cancel request, `RpcActiveTaskTracker` force-terminates the task (idempotent
    for entries that are already `aborted`), and **whether the ledger entry stays is decided by that tool's own
    retention policy** (§5.2.2). The task actually stops only if the tool itself listens to `this.ctx.signal` (§5.1).
- **Cancellation is logical, not physical: the transport must still be online afterwards.** Other calls on the same
  channel keep working; a transport must not `stop()`, drop a long-lived connection, or close the mailbox because one
  call was cancelled. A physical disconnect is neither the **mechanism** of cancellation (the two points above list
  where it does not reach) nor its **result**: the server learns to stop from `$cancel`, not from guessing that "the
  connection went away".

### 5.2.1 Resource release: `cleanup` / `onClose` belong to the tool; RPC never calls them on its behalf

- Per-call **`cleanup`** is driven by `makeToolFuncLifecycle` from `@isdk/tool-func`, and it **only takes effect on a
  registry class that explicitly installs it** (`makeToolFuncLifecycle(ServerTools)`). The RPC server side neither
  installs that ability nor calls `tool.cleanup(params, ctx)` on the tool's behalf: the latter is not the same contract
  as tool-func's `cleanup(this)` — the dispatcher only has `params`/`ctx`, not the shadow instance that actually ran
  this call, so it cannot release what this call acquired. Without the ability the hook never runs at all; with it
  installed, an extra RPC-side call breaks exactly the exactly-once guarantee tool-func promises.
- **One call may open only one call scope**: after `RpcServerDispatcher.performExecution` builds the shadow instance
  with `tool.with(context)`, it **must not** also pass the same `context` as the second argument — tool-func would
  isolate once more on that `ctx`, both scopes would consider themselves the owner, and `cleanup` would run twice.
  Tools read the context through `this.ctx`; the legacy-compat `_req`/`_res`/`_signal` injection falls back to
  `this.ctx` in `ServerTools.run`. Only a **custom registry** (no tool-func `with`) receives ctx as the second
  argument.
- **Streaming tools** release through the `onClose(status, reason)` they attach when they build the stream
  (`'final' | 'error' | 'cancel'`): when the ledger aborts, `RpcActiveTaskHandle` calls `outputStream.cancel(reason)`,
  cancellation travels up the stream chain to the tool, and `status` is `'cancel'`. This has nothing to do with the
  lifecycle ability and does not need `makeToolFuncLifecycle`.

### 5.2.2 Ledger entries after cancellation: retention decides, 404 after deregistration is expected

- `$cancel` **must not** deregister the ledger entry unconditionally: `tracker.remove()` bypasses `shouldCleanup()`, so
  a cancelled record inside a `Permanent` or numeric retention window vanishes on the spot and the client can only ever
  ask and get a 404, unable to tell "did this cancellation actually stop anything" — while the very same task killed by
  a hard deadline keeps its entry (polling returns 408). One terminal state must not have two levels of visibility.
- **The moment of cancellation starts the retention clock**: `RpcActiveTaskHandle.abort()` stamps `completedAt` at the
  `abort()` instant, so a numeric retention window is measured from the cancellation, not from registration.
- What each policy yields:

  | retention | Ledger after cancellation | A later GET |
  | --- | --- | --- |
  | default (`None`) | dropped on the spot | **404** |
  | numeric `N` ms | kept until `cancellation + N` | **408** (terminal state) inside the window, 404 afterwards |
  | `'once'` | kept until read once, or until the `onceFallbackMs` backstop (default `3600000`, i.e. 1 hour) | **408** |
  | `Permanent` | kept (§6.1 "never evicted") | **408** |

- **Once an entry is deregistered, a later `GET` or `$cancel` must return 404; the client must read that as "the server
  already took the cancellation and this is settled", never as a failed cancellation**: the cancel notification is
  fire-and-forget, and under the default policy the entry is gone immediately.
- **A terminal state read by polling must not be remapped to 504**: the 408 thrown by `RpcTaskResource.get` is a state
  sitting in the ledger, not a timeout of this polling call (in the implementation it is marked with
  `RpcError.isTaskState`), consistent with §4.2's "408 only appears on the polling path".
- **The same `req-id` cannot be resubmitted inside the retention window**: `RpcActiveTaskTracker.add` only checks
  whether an entry exists, not whether it is terminal, so colliding with a cancelled entry that is still inside its
  retention window yields **409**. Cancelling does not mean "this id is free again" — a retry must use a new `req-id`.
  (Under the default `None` the entry is dropped on the spot, so nothing collides; `Permanent` means that id stays
  claimed forever.)
- **`isTaskState` is an implementation detail, not protocol**: only the terminal-state errors thrown by the ledger's
  `get` carry it, and its only job is to dodge `handleError`'s 408 → 504 remapping. It never goes on the wire (what
  goes on the wire is the `error` payload `handleError` rebuilds); neither clients nor business tools should set it or
  rely on it. The ledger's 102 (`Keep Polling`) does **not** carry the marker — only terminal states do; 102 goes
  through the 102 branch of §4.2.
- **`retention` is an instance field**: `ServerTools.register({ retention: 5000, ... })` gets filtered away by
  tool-func's schema (`tool.retention` stays `undefined`). To make it take effect, register an instance (write a
  `ServerTools` subclass with a `retention = 5000` class field, `new` it, then `ServerTools.register(inst)`), or write
  the field onto the instance after registration.

### 5.3 Resource release

- After a timeout fires, the transport must make sure every associated stream and socket is closed properly.

---

## 6. Streaming behaviour

- **Time to first byte (TTFB)**: from sending the request to receiving the first chunk, the time must not exceed
  `streamIdleTimeout` (if unset, it degrades to `timeout.value`).
- **Gap timeout**: the interval between any two adjacent chunks must not exceed `streamIdleTimeout`.
- **Handling**: once either fires, the transport raises a timeout to the application layer and closes the connection.

### 6.1 Requirements on transport implementations (applies to all transports)

Timeout and stream semantics live in `RpcServerDispatcher`, so **a custom server-side transport should extend
`ServerToolTransport` and reuse its `processIncomingCall(rawReq, rawRes, registry?)`** (`src/transports/server.ts`,
`protected`) instead of calling `dispatcher.dispatch()` directly. This is not a style preference:

| Going through `processIncomingCall` | What calling `dispatch` yourself skips |
| --- | --- |
| Identity policy checks (`identity`) and `manager.validateRpcRequest()` (SSRF / protocol allow-list) | every architectural policy check stops working |
| The layered registry view from `requestRegistry()` (prefix claim → transport → dispatcher → system) | with several prefixes/registries, tools resolve against the wrong one |
| The post-check of the transport's `canStream` capability (returns 400) | a transport that cannot stream serialises the stream as a plain object |
| Errors normalised into a `ToolRpcResponse` (top-level guard) | you must implement your own error mapping, and it tends to drift |

> The pre-flight conflict check between the caller's streaming intent and the tool's `stream` capability happens in the
> **dispatcher** (`resolveTool()`: `params.stream && !tool.stream` → 400), which is a different gate from the
> transport's `canStream` post-check (`server.ts`: the tool returned a stream but the protocol cannot carry it → 400).

A streaming transport also has to arm `streamIdleTimeout` (TTFB plus chunk gaps) inside `start()`, and destroy
still-open streams in `stop()` — otherwise idle streams leak. Reference implementation: `HttpServerToolTransport`
(`src/transports/http-server.ts`).

> Known gap: `IpcServerToolTransport` in `@isdk/tool-electron` currently calls `dispatcher.dispatch()` directly, so the
> four pre-checks above never run (it also ignores `streamIdleTimeout`, and its `stop()` does not unregister route
> ownership). It should be moved to `processIncomingCall`.

---

## 7. Tool discovery

- `ServerTools.toJSON()` must include the `timeout` and `expectedDuration` fields.
- Clients must inject those values into the dynamically generated `ClientTools` instances during `loadFrom()`.
