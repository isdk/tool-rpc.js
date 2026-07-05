[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / HttpServerToolTransportOptions

# Interface: HttpServerToolTransportOptions

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:8](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L8)

## Extends

- [`ServerToolTransportOptions`](ServerToolTransportOptions.md).`ServerOptions`

## Indexable

> \[`key`: `string`\]: `any`

## Properties

### apiUrl?

> `optional` **apiUrl?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:11](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L11)

#### Inherited from

[`ServerToolTransportOptions`](ServerToolTransportOptions.md).[`apiUrl`](ServerToolTransportOptions.md#apiurl)

***

### connectionsCheckingInterval?

> `optional` **connectionsCheckingInterval?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:283

Sets the interval value in milliseconds to check for request and headers timeout in incomplete requests.

#### Default

```ts
30000
```

#### Inherited from

`http.ServerOptions.connectionsCheckingInterval`

***

### dispatcher?

> `optional` **dispatcher?**: [`RpcServerDispatcher`](../classes/RpcServerDispatcher.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/server.ts:7](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/server.ts#L7)

#### Inherited from

[`ServerToolTransportOptions`](ServerToolTransportOptions.md).[`dispatcher`](ServerToolTransportOptions.md#dispatcher)

***

### headersTimeout?

> `optional` **headersTimeout?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:290

Sets the timeout value in milliseconds for receiving the complete HTTP headers from the client.
See Server.headersTimeout for more information.

#### Default

```ts
60000
```

#### Since

18.0.0

#### Inherited from

`http.ServerOptions.headersTimeout`

***

### highWaterMark?

> `optional` **highWaterMark?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:297

Optionally overrides all `socket`s' `readableHighWaterMark` and `writableHighWaterMark`.
This affects `highWaterMark` property of both `IncomingMessage` and `ServerResponse`.
Default:

#### See

stream.getDefaultHighWaterMark().

#### Since

v20.1.0

#### Inherited from

`http.ServerOptions.highWaterMark`

***

### IncomingMessage?

> `optional` **IncomingMessage?**: *typeof* `IncomingMessage`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:246

Specifies the `IncomingMessage` class to be used. Useful for extending the original `IncomingMessage`.

#### Inherited from

`http.ServerOptions.IncomingMessage`

***

### insecureHTTPParser?

> `optional` **insecureHTTPParser?**: `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:304

Use an insecure HTTP parser that accepts invalid HTTP headers when `true`.
Using the insecure parser should be avoided.
See --insecure-http-parser for more information.

#### Default

```ts
false
```

#### Inherited from

`http.ServerOptions.insecureHTTPParser`

***

### joinDuplicateHeaders?

> `optional` **joinDuplicateHeaders?**: `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:263

It joins the field line values of multiple headers in a request with `, ` instead of discarding the duplicates.

#### Default

```ts
false
```

#### Since

v18.14.0

#### Inherited from

`http.ServerOptions.joinDuplicateHeaders`

***

### keepAlive?

> `optional` **keepAlive?**: `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:331

If set to `true`, it enables keep-alive functionality on the socket immediately after a new incoming connection is received,
similarly on what is done in `socket.setKeepAlive([enable][, initialDelay])`.

#### Default

```ts
false
```

#### Since

v16.5.0

#### Inherited from

`http.ServerOptions.keepAlive`

***

### keepAliveInitialDelay?

> `optional` **keepAliveInitialDelay?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:337

If set to a positive number, it sets the initial delay before the first keepalive probe is sent on an idle socket.

#### Default

```ts
0
```

#### Since

v16.5.0

#### Inherited from

`http.ServerOptions.keepAliveInitialDelay`

***

### keepAliveTimeout?

> `optional` **keepAliveTimeout?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:271

The number of milliseconds of inactivity a server needs to wait for additional incoming data,
after it has finished writing the last response, before a socket will be destroyed.

#### See

Server.keepAliveTimeout for more information.

#### Default

```ts
5000
```

#### Since

v18.0.0

#### Inherited from

`http.ServerOptions.keepAliveTimeout`

***

### keepAliveTimeoutBuffer?

> `optional` **keepAliveTimeoutBuffer?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:278

An additional buffer time added to the
`server.keepAliveTimeout` to extend the internal socket timeout.

#### Since

24.6.0

#### Default

```ts
1000
```

#### Inherited from

`http.ServerOptions.keepAliveTimeoutBuffer`

***

### manager?

> `optional` **manager?**: [`RpcTransportManager`](../classes/RpcTransportManager.md)

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/base.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/base.ts#L10)

#### Inherited from

[`ServerToolTransportOptions`](ServerToolTransportOptions.md).[`manager`](ServerToolTransportOptions.md#manager)

***

### maxBodySize?

> `optional` **maxBodySize?**: `number`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/http-server.ts:10](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/http-server.ts#L10)

最大请求体大小 (字节)，默认 1MB

***

### maxHeaderSize?

> `optional` **maxHeaderSize?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:311

Optionally overrides the value of `--max-http-header-size` for requests received by
this server, i.e. the maximum length of request headers in bytes.

#### Default

```ts
16384
```

#### Since

v13.3.0

#### Inherited from

`http.ServerOptions.maxHeaderSize`

***

### noDelay?

> `optional` **noDelay?**: `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:317

If set to `true`, it disables the use of Nagle's algorithm immediately after a new incoming connection is received.

#### Default

```ts
true
```

#### Since

v16.5.0

#### Inherited from

`http.ServerOptions.noDelay`

***

### optimizeEmptyRequests?

> `optional` **optimizeEmptyRequests?**: `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:367

If set to `true`, requests without `Content-Length` or `Transfer-Encoding` headers (indicating no body)
will be initialized with an already-ended body stream, so they will never emit any stream events
(like `'data'` or `'end'`). You can use `req.readableEnded` to detect this case.

#### Default

```ts
false
```

#### Since

v24.12.0

#### Inherited from

`http.ServerOptions.optimizeEmptyRequests`

***

### rejectNonStandardBodyWrites?

> `optional` **rejectNonStandardBodyWrites?**: `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:359

If set to `true`, an error is thrown when writing to an HTTP response which does not have a body.

#### Default

```ts
false
```

#### Since

v18.17.0, v20.2.0

#### Inherited from

`http.ServerOptions.rejectNonStandardBodyWrites`

***

### requestTimeout?

> `optional` **requestTimeout?**: `number`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:257

Sets the timeout value in milliseconds for receiving the entire request from the client.

#### See

Server.requestTimeout for more information.

#### Default

```ts
300000
```

#### Since

v18.0.0

#### Inherited from

`http.ServerOptions.requestTimeout`

***

### requireHostHeader?

> `optional` **requireHostHeader?**: `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:324

If set to `true`, it forces the server to respond with a 400 (Bad Request) status code
to any HTTP/1.1 request message that lacks a Host header (as mandated by the specification).

#### Default

```ts
true
```

#### Since

20.0.0

#### Inherited from

`http.ServerOptions.requireHostHeader`

***

### ServerResponse?

> `optional` **ServerResponse?**: *typeof* `ServerResponse`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:250

Specifies the `ServerResponse` class to be used. Useful for extending the original `ServerResponse`.

#### Inherited from

`http.ServerOptions.ServerResponse`

***

### shouldUpgradeCallback?

> `optional` **shouldUpgradeCallback?**: (`request`) => `boolean`

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:353

A callback which receives an
incoming request and returns a boolean, to control which upgrade attempts
should be accepted. Accepted upgrades will fire an `'upgrade'` event (or
their sockets will be destroyed, if no listener is registered) while
rejected upgrades will fire a `'request'` event like any non-upgrade
request.

#### Parameters

##### request

`IncomingMessage`

#### Returns

`boolean`

#### Since

v24.9.0

#### Default

```ts
() => server.listenerCount('upgrade') > 0
```

#### Inherited from

`http.ServerOptions.shouldUpgradeCallback`

***

### uniqueHeaders?

> `optional` **uniqueHeaders?**: (`string` \| `string`[])[]

Defined in: @isdk/ai-tools/node\_modules/.pnpm/@types+node@24.12.4/node\_modules/@types/node/http.d.ts:342

A list of response headers that should be sent only once.
If the header's value is an array, the items will be joined using `; `.

#### Inherited from

`http.ServerOptions.uniqueHeaders`
