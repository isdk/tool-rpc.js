// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { findPort } from '@isdk/util'
import { ToolFunc } from '@isdk/tool-func'
import { HttpClientToolTransport } from '../src/transports/http-client'
import { HttpServerToolTransport } from '../src/transports/http-server'
import { RpcServerDispatcher } from '../src/transports/dispatcher'
import { RpcClientTransportManager } from '../src/transports/client-manager'
import { ServerTools } from '../src/server-tools'
import { ClientTools } from '../src/client-tools'
import { RPC_HEADERS } from '../src/transports/models'

describe('HttpClientToolTransport Integration', () => {
  let server: HttpServerToolTransport
  let port: number
  let apiRoot: string

  beforeAll(async () => {
    // Reset registries
    ToolFunc.items = {}

    const serverItems: Record<string, any> = {}
    Object.setPrototypeOf(serverItems, ToolFunc.items)
    ServerTools.items = serverItems

    const clientItems: Record<string, any> = {}
    Object.setPrototypeOf(clientItems, ToolFunc.items)
    ClientTools.items = clientItems

    // Setup Dispatcher Registry
    RpcServerDispatcher.instance.registry = ServerTools

    // ── Register Server-Side Tools (using async function, NOT arrow functions) ──

    // Echo tool
    ServerTools.register({
      name: 'echo',
      params: { msg: { type: 'string' } },
      func: async function(params: any) {
        return params?.msg || null
      } as any,
      isApi: true,
    })

    // Calculator
    ServerTools.register({
      name: 'calc',
      params: { a: { type: 'number' }, b: { type: 'number' } },
      func: async function({ a, b }: { a: number, b: number }) {
        return a + b
      } as any,
      isApi: true,
      timeout: 5000,
    })

    // Error tool
    ServerTools.register({
      name: 'error-tool',
      params: { code: { type: 'number' } },
      func: async function({ code = 400 }: { code?: number }) {
        const err: any = new Error(`Intentional Error [${code}]`)
        err.code = code
        err.status = code >= 500 ? 'server_error' : 'bad_request'
        throw err
      } as any,
      isApi: true,
    })

    // Composer tool — calls calc internally via runAs
    ServerTools.register({
      name: 'composer',
      params: { x: { type: 'number' }, y: { type: 'number' }, label: { type: 'string' } },
      func: async function(this: any, params: any) {
        const sum = await this.runAs('calc', { a: params.x, b: params.y })
        return { label: params.label || 'result', sum }
      } as any,
      isApi: true,
      timeout: 3000,
    })

    // Streaming tool — emits multiple chunks
    ServerTools.register({
      name: 'stream-tool',
      isApi: true,
      stream: true,
      func: async function() {
        const encoder = new TextEncoder()
        return new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('chunk1'))
            controller.enqueue(encoder.encode('chunk2'))
            controller.enqueue(encoder.encode('chunk3'))
            controller.close()
          }
        })
      } as any,
    })

    // Streaming tool with configurable gap between chunks
    ServerTools.register({
      name: 'stream-gap-tool',
      isApi: true,
      stream: true,
      params: { gap: { type: 'number' } },
      func: async function({ gap = 50 }: { gap?: number }) {
        const encoder = new TextEncoder()
        return new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode('first'))
            await new Promise(resolve => setTimeout(resolve, gap))
            controller.enqueue(encoder.encode('second'))
            await new Promise(resolve => setTimeout(resolve, gap))
            controller.enqueue(encoder.encode('third'))
            controller.close()
          }
        })
      } as any,
    })

    // Slow tool for AbortSignal / timeout tests
    ServerTools.register({
      name: 'delay-tool',
      params: { delay: { type: 'number' } },
      func: async function({ delay = 200 }: { delay?: number }) {
        await new Promise(resolve => setTimeout(resolve, delay))
        return 'done'
      } as any,
      isApi: true,
    })

    // Slow-start stream tool — delays before returning a ReadableStream
    // Combines keepAliveOnTimeout (for 102 polling) with stream: true
    ServerTools.register({
      name: 'slow-stream-tool',
      isApi: true,
      stream: true,
      timeout: { value: 100, keepAliveOnTimeout: true },
      params: { delay: { type: 'number' } },
      func: async function({ delay = 300 }: { delay?: number }) {
        await new Promise(resolve => setTimeout(resolve, delay))
        const encoder = new TextEncoder()
        return new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('start'))
            controller.enqueue(encoder.encode('middle'))
            controller.enqueue(encoder.encode('end'))
            controller.close()
          }
        })
      } as any,
    })

    // Slow polling-only tool — triggers 102 but doesn't stream
    ServerTools.register({
      name: 'slow-poll-tool',
      isApi: true,
      timeout: { value: 100, keepAliveOnTimeout: true },
      params: { delay: { type: 'number' } },
      func: async function(params: any) {
        const delay = params?.delay || 300
        const signal = (this as any).ctx?.signal
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => resolve(`poll-done-${delay}`), delay)
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              const err = new Error('Aborted by signal')
              err.name = 'AbortError'
              reject(err)
            }, { once: true })
          }
        })
      } as any,
    })

    // ── Start Server ──
    port = await findPort(3010)
    apiRoot = `http://localhost:${port}/api`

    server = new HttpServerToolTransport({ port, apiUrl: apiRoot })
    server.addRpcHandler(apiRoot)
    server.addDiscoveryHandler(apiRoot, () => ServerTools.toJSON())
    await server.start({ port, host: 'localhost' })
  })

  afterAll(async () => {
    await server.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  describe('Transport Construction', () => {
    it('should construct with apiUrl and store it', () => {
      const transport = new HttpClientToolTransport(apiRoot)
      expect(transport.apiUrl).toBe(apiRoot)
    })

    it('should throw if apiUrl is empty', () => {
      expect(() => new (HttpClientToolTransport as any)()).toThrow('apiUrl is required')
    })
  })

  describe('HTTP Method & URL Construction (spy-based)', () => {
    let client: HttpClientToolTransport

    beforeAll(() => {
      client = new HttpClientToolTransport(apiRoot)
    })

    it('should send POST for default action', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      try {
        await client._fetch('echo', { msg: 'hi' }, 'run')
        const [, opts] = spy.mock.calls[0]
        expect((opts as any).method).toBe('POST')
        expect((opts as any).body).toBe(JSON.stringify({ msg: 'hi' }))
      } finally {
        spy.mockRestore()
      }
    })

    it('should send GET for "get" action', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      try {
        await client._fetch('echo', { msg: 'test' }, 'get')
        const [url, opts] = spy.mock.calls[0]
        expect((opts as any).method).toBe('GET')
        expect(url).toContain('/echo')
        const parsed = new URL(url as string)
        expect(parsed.searchParams.get('p')).toBe(JSON.stringify({ msg: 'test' }))
      } finally {
        spy.mockRestore()
      }
    })

    it('should send DELETE for "delete" action', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      try {
        await client._fetch('echo', null, 'delete', 'item-42')
        const [url, opts] = spy.mock.calls[0]
        expect((opts as any).method).toBe('DELETE')
        expect(url).toContain('/echo/item-42')
      } finally {
        spy.mockRestore()
      }
    })

    it('should send GET for "list" action', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      try {
        await client._fetch('echo', null, 'list')
        const [, opts] = spy.mock.calls[0]
        expect((opts as any).method).toBe('GET')
      } finally {
        spy.mockRestore()
      }
    })

    it('should inject RPC headers into the request', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      try {
        const opts = { headers: { 'x-custom': 'val' } }
        await client._fetch('myTool', { k: 'v' }, 'custom-act', 'res-001', opts)
        const [, reqOpts] = spy.mock.calls[0]
        const headers = (reqOpts as any).headers
        expect(headers[RPC_HEADERS.FUNC]).toBe('myTool')
        expect(headers[RPC_HEADERS.ACT]).toBe('custom-act')
        expect(headers[RPC_HEADERS.RES_ID]).toBe('res-001')
        expect(headers['x-custom']).toBe('val')
      } finally {
        spy.mockRestore()
      }
    })

    it('should construct correct URL with tool name and resId', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      try {
        await client._fetch('myTool', null, 'run', 'res-99')
        const [urlStr] = spy.mock.calls[0]
        const url = new URL(urlStr as string)
        expect(url.pathname).toBe('/api/myTool/res-99')
        expect(url.origin).toBe(`http://localhost:${port}`)
      } finally {
        spy.mockRestore()
      }
    })

    it('should preserve base URL query params and hash', async () => {
      const transport = new HttpClientToolTransport(`${apiRoot}/v2?token=abc#section`)
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      try {
        await transport._fetch('test', null, 'run')
        const [urlStr] = spy.mock.calls[0]
        const url = new URL(urlStr as string)
        expect(url.pathname).toBe('/api/v2/test')
        expect(url.searchParams.get('token')).toBe('abc')
        expect(url.hash).toBe('#section')
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('Real HTTP Round-Trip', () => {
    let client: HttpClientToolTransport

    beforeAll(() => {
      client = new HttpClientToolTransport(apiRoot)
    })

    it('should receive correct echo response', async () => {
      const res = await client._fetch('echo', { msg: 'hello' }, 'run')
      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body).toBe('hello')
    })

    it('should convert response via toObject', async () => {
      const res = await client._fetch('echo', { msg: 'to-obj' }, 'run')
      const obj = await client.toObject(res)
      expect(obj).toBe('to-obj')
    })

    it('should handle GET request and receive result', async () => {
      const res = await client._fetch('echo', { msg: 'get-test' }, 'get')
      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body).toBe('get-test')
    })

    it('should handle null params gracefully', async () => {
      const res = await client._fetch('echo', null, 'run')
      expect(res.ok).toBe(true)
    })
  })

  describe('Error Handling', () => {
    let client: HttpClientToolTransport

    beforeAll(() => {
      client = new HttpClientToolTransport(apiRoot)
    })

    it('should throw RPC Error [400] for bad request', async () => {
      try {
        await client._fetch('error-tool', { code: 400 }, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [400]')
        expect(err.code).toBe(400)
        expect(err.status).toBe('bad_request')
      }
    })

    it('should throw for server internal error (500)', async () => {
      try {
        await client._fetch('error-tool', { code: 500 }, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [500]')
        expect(err.code).toBe(500)
        expect(err.status).toBe('server_error')
      }
    })

    it('should throw 404 for non-existent tool', async () => {
      try {
        await client._fetch('nonexistent-tool', {}, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [404]')
      }
    })
  })

  describe('API Discovery (loadApis)', () => {
    let client: HttpClientToolTransport

    beforeAll(() => {
      client = new HttpClientToolTransport(apiRoot)
    })

    it('should discover available tools via GET on root', async () => {
      const apis = await client.loadApis()
      expect(apis).toBeDefined()
      expect(apis.echo).toBeDefined()
      expect(apis.calc).toBeDefined()
      expect(apis['error-tool']).toBeDefined()
    })

    it('should return tool metadata with params and timeout', async () => {
      const apis = await client.loadApis()
      const echoMeta = apis.echo
      expect(echoMeta.params).toBeDefined()
      expect(echoMeta.params.msg).toBeDefined()
      expect(echoMeta.params.msg.type).toBe('string')

      const calcMeta = apis.calc
      expect(calcMeta.timeout).toBe(5000)
    })
  })

  describe('End-to-End via ClientTools', () => {
    beforeAll(async () => {
      const client = new HttpClientToolTransport(apiRoot)
      ClientTools.setTransport(client)
      await ClientTools.loadFrom()
    })

    it('should call discovered echo tool', async () => {
      const tool = ClientTools.get('echo')!
      const result = await tool.run({ msg: 'e2e-test' })
      expect(result).toBe('e2e-test')
    })

    it('should call discovered calc tool', async () => {
      const tool = ClientTools.get('calc')!
      const result = await tool.run({ a: 10, b: 25 })
      expect(result).toBe(35)
    })

    it('should propagate errors from discovered tools', async () => {
      const errTool = ClientTools.get('error-tool')!
      try {
        await errTool.run({ code: 400 })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [400]')
      }
    })

    it('should handle concurrent requests to different tools', async () => {
      const [echoResult, calcResult] = await Promise.all([
        ClientTools.get('echo')!.run({ msg: 'concurrent' }),
        ClientTools.get('calc')!.run({ a: 7, b: 8 }),
      ])
      expect(echoResult).toBe('concurrent')
      expect(calcResult).toBe(15)
    })
  })

  describe('Transport Caching via RpcClientTransportManager', () => {
    beforeAll(() => {
      RpcClientTransportManager.bindScheme('http', HttpClientToolTransport)
    })

    afterAll(() => {
      RpcClientTransportManager.clearSchemes()
    })

    it('should return cached instance for same apiUrl', () => {
      const t1 = RpcClientTransportManager.instance.getClient(apiRoot)
      const t2 = RpcClientTransportManager.instance.getClient(apiRoot)
      expect(t1).toBe(t2)
    })

    it('should return different instances for different URLs', () => {
      const t1 = RpcClientTransportManager.instance.getClient(apiRoot)
      const t2 = RpcClientTransportManager.instance.getClient(`http://localhost:${port}/other`)
      expect(t1).not.toBe(t2)
    })
  })

  describe('HTTP Streaming', () => {
    let client: HttpClientToolTransport

    beforeAll(() => {
      client = new HttpClientToolTransport(apiRoot)
    })

    it('should stream data via _fetch and read chunks', async () => {
      const res = await client._fetch('stream-tool', { stream: true }, 'run')
      expect(res.ok).toBe(true)
      expect(res.body).toBeDefined()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let allData = ''

      let done = false
      while (!done) {
        const { value, done: isDone } = await reader.read()
        if (isDone) { done = true; break }
        allData += decoder.decode(value, { stream: !done })
      }

      // Synchronous chunks may be coalesced by HTTP,
      // verify all data is received regardless of chunk boundaries
      expect(allData).toContain('chunk1')
      expect(allData).toContain('chunk2')
      expect(allData).toContain('chunk3')
      // All 18 characters (6 per chunk) combined
      expect(allData.length).toBe('chunk1chunk2chunk3'.length)
    })

    it('should stream with time gaps between chunks', async () => {
      const start = Date.now()
      const res = await client._fetch('stream-gap-tool', { gap: 100, stream: true }, 'run')
      expect(res.ok).toBe(true)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const chunks: string[] = []

      let done = false
      while (!done) {
        const { value, done: isDone } = await reader.read()
        if (isDone) { done = true; break }
        chunks.push(decoder.decode(value))
      }

      const elapsed = Date.now() - start
      expect(chunks).toEqual(['first', 'second', 'third'])
      // 3 chunks with 2 gaps of 100ms each = at least 200ms
      expect(elapsed).toBeGreaterThanOrEqual(190)
    })

    it('should allow cancelling stream mid-transfer', async () => {
      const res = await client._fetch('stream-gap-tool', { gap: 500, stream: true }, 'run')
      expect(res.ok).toBe(true)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      // Read first chunk
      const first = await reader.read()
      expect(decoder.decode(first.value)).toBe('first')

      // Cancel before second chunk arrives
      await reader.cancel('Cancelled by test')

      // Should be done/cancelled
      const next = await reader.read()
      expect(next.done).toBe(true)
    })

    it('should enforce stream idle timeout', async () => {
      // stream-gap-tool has 200ms gap between chunks
      // Set streamIdleTimeout to 50ms — should fire before second chunk
      const res = await client._fetch('stream-gap-tool', { gap: 200, stream: true }, 'run', undefined, {
        timeout: { value: 5000, streamIdleTimeout: 50 }
      })
      expect(res.ok).toBe(true)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      // First chunk should arrive
      const first = await reader.read()
      expect(decoder.decode(first.value)).toBe('first')

      // Second chunk should timeout because gap (200ms) > streamIdleTimeout (50ms)
      try {
        await reader.read()
        expect.fail('Should have timed out on idle')
      } catch (err: any) {
        expect(err.message).toMatch(/Idle Timeout/i)
      }
    })

    it('should stream via full ClientTools path with { stream: true }', async () => {
      // Go through ClientTools (via setTransport from earlier section)
      const streamTool = ClientTools.get('stream-tool')!
      const res = await streamTool.run({ stream: true })

      // When stream: true is in args, executeWithPolling returns the raw Response
      expect(res).toBeDefined()
      expect(res.body).toBeDefined()
      expect(typeof res.body.getReader).toBe('function')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let allData = ''

      let done = false
      while (!done) {
        const { value, done: isDone } = await reader.read()
        if (isDone) { done = true; break }
        allData += decoder.decode(value, { stream: !done })
      }

      expect(allData).toContain('chunk1')
      expect(allData).toContain('chunk2')
      expect(allData).toContain('chunk3')
      expect(allData.length).toBe('chunk1chunk2chunk3'.length)
    })
  })

  describe('Error Recovery & Edge Cases', () => {
    let client: HttpClientToolTransport

    beforeAll(() => {
      client = new HttpClientToolTransport(apiRoot)
    })

    describe('Network & Transport Errors', () => {
      it('should propagate network errors from fetch', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network Failure'))
        try {
          await client._fetch('echo', { msg: 'x' }, 'run')
          expect.fail('Should have thrown')
        } catch (err: any) {
          expect(err.message).toBe('Network Failure')
        } finally {
          spy.mockRestore()
        }
      })

      it('should handle non-JSON error responses gracefully', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        }))
        try {
          await client._fetch('echo', { msg: 'x' }, 'run')
          expect.fail('Should have thrown')
        } catch (err: any) {
          expect(err.message).toContain('RPC Error [500]')
          expect(err.message).toContain('Internal Server Error')
        } finally {
          spy.mockRestore()
        }
      })

      it('should handle empty error body', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', {
          status: 503,
          statusText: 'Service Unavailable',
        }))
        try {
          await client._fetch('echo', { msg: 'x' }, 'run')
          expect.fail('Should have thrown')
        } catch (err: any) {
          expect(err.message).toContain('RPC Error [503]')
          expect(err.message).toContain('Service Unavailable')
        } finally {
          spy.mockRestore()
        }
      })
    })

    describe('Timeout & Abort', () => {
      it('should abort with 504 on client-side timeout', async () => {
        const slowTool = ClientTools.get('echo')!
        try {
          // Server can't possibly respond in 1ms
          await slowTool.run({ msg: 'fast?' }, { timeout: 1 })
          expect.fail('Should have timed out')
        } catch (err: any) {
          expect(err.code).toBe(504)
          expect(err.message).toMatch(/Timeout/i)
        }
      })

      it('should handle AbortSignal interruption', async () => {
        const controller = new AbortController()
        // Use delay-tool which waits 500ms — enough time for abort to fire
        const delayTool = ClientTools.get('delay-tool')!

        // Abort before the slow request completes
        setTimeout(() => controller.abort(), 50)

        try {
          await delayTool.run({ delay: 500 }, { signal: controller.signal })
          expect.fail('Should have been aborted')
        } catch (err: any) {
          expect(err.name).toBe('AbortError')
        }
      })

      it('should reject pre-aborted signal immediately via executeWithPolling', async () => {
        // Go through the full fetch() path (executeWithPolling checks signal.aborted upfront)
        const controller = new AbortController()
        controller.abort()

        try {
          // Use client.fetch() instead of client._fetch() to trigger executeWithPolling's pre-abort check
          await client.fetch('echo', { msg: 'x' }, 'run', undefined, { signal: controller.signal })
          expect.fail('Should have thrown')
        } catch (err: any) {
          expect(err.name).toBe('AbortError')
        }
      })
    })

    describe('Unreachable Server & Wrong Scheme', () => {
      it('should fail when connecting to unreachable server', async () => {
        const deadClient = new HttpClientToolTransport('http://localhost:1/api')
        try {
          await deadClient._fetch('echo', { msg: 'x' }, 'run')
          expect.fail('Should have thrown')
        } catch (err: any) {
          // Expected: connection refused or timeout
          expect(err).toBeDefined()
        }
      })

      it('should throw on unsupported URL scheme', async () => {
        // The transport was pre-registered via setTransport() from earlier section.
        // To test the scheme lookup path, we need a URL not in the transport cache.
        const savedScheme = (RpcClientTransportManager as any).schemeRegistry?.get('http')
        RpcClientTransportManager.clearSchemes()

        try {
          // Use a fresh URL that's not pre-registered in the manager's transport cache
          const freshUrl = `http://localhost:${port}/unregistered-path`
          await RpcClientTransportManager.instance.getClient(freshUrl)
          expect.fail('Should have thrown about unsupported scheme')
        } catch (err: any) {
          expect(err.message).toMatch(/Unsupported URL scheme/)
        } finally {
          // Restore scheme for other tests
          if (savedScheme) {
            RpcClientTransportManager.bindScheme('http', savedScheme)
          }
        }
      })
    })

    describe('loadApis Failure Scenarios', () => {
      it('should fail loadApis on unreachable server', async () => {
        const deadClient = new HttpClientToolTransport('http://localhost:1/api')
        try {
          await deadClient.loadApis()
          expect.fail('Should have thrown')
        } catch (err: any) {
          // Expected: connection refused or ECONNREFUSED
          expect(err).toBeDefined()
        }
      })

      it('should fail loadFrom when apiUrl is missing', async () => {
        // Create a connected service then clear its apiUrl
        const srv = ClientTools.connect('http://temp/api')
        srv.apiUrl = undefined as any

        try {
          await srv.loadFrom(undefined, {})
          expect.fail('Should have thrown about missing apiUrl')
        } catch (err: any) {
          expect(err.message).toMatch(/apiUrl is required/)
        }
      })
    })
  })

  describe('HTTP 102 + Streaming Composite', () => {
    let client: HttpClientToolTransport

    beforeAll(() => {
      client = new HttpClientToolTransport(apiRoot)
    })

    it('should stream from slow-start tool via 102 polling + stream', async () => {
      // slow-stream-tool: soft timeout 100ms, keepAliveOnTimeout, stream: true
      // It delays 300ms before returning the ReadableStream.
      // The deadline guard fires at 100ms → 102 processing response → polling →
      // tool completes → stream returned via poll → executeWithPolling checks
      // args?.stream → returns raw Response with stream body.
      const res = await client.fetch('slow-stream-tool', { delay: 300, stream: true }, 'run')

      // The result should be a Response with stream body (not a 102 object)
      expect(res).toBeDefined()
      expect(res.status).toBe(200)
      expect(res.body).toBeDefined()
      expect(typeof res.body.getReader).toBe('function')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let allData = ''
      let done = false
      while (!done) {
        const { value, done: isDone } = await reader.read()
        if (isDone) { done = true; break }
        allData += decoder.decode(value, { stream: !done })
      }

      expect(allData).toContain('start')
      expect(allData).toContain('middle')
      expect(allData).toContain('end')
    })

    it('should handle concurrent: 102 polling (slow-poll-tool) + streaming (stream-tool)', async () => {
      // slow-poll-tool triggers 102 polling (100ms soft timeout, 300ms delay)
      // stream-tool streams immediately — both run concurrently
      const [pollRes, streamRes] = await Promise.all([
        client.fetch('slow-poll-tool', { delay: 300 }),
        client.fetch('stream-tool', { stream: true }, 'run'),
      ])

      expect(pollRes).toBe('poll-done-300')

      expect(streamRes.ok).toBe(true)
      expect(streamRes.body).toBeDefined()

      const reader = streamRes.body.getReader()
      const decoder = new TextDecoder()
      let allData = ''
      let done = false
      while (!done) {
        const { value, done: isDone } = await reader.read()
        if (isDone) { done = true; break }
        allData += decoder.decode(value, { stream: !done })
      }

      expect(allData).toContain('chunk1')
      expect(allData).toContain('chunk2')
      expect(allData).toContain('chunk3')
    })

    it('should handle slow-start stream + concurrent fast echo call', async () => {
      const [slowRes, echoRes] = await Promise.all([
        client.fetch('slow-stream-tool', { delay: 300, stream: true }, 'run'),
        client.fetch('echo', { msg: 'during-stream' }, 'run'),
      ])

      // Echo should complete normally (during the slow-start stream's delay)
      expect(echoRes).toBe('during-stream')

      // Stream should be a Response with body
      expect(slowRes.status).toBe(200)
      expect(slowRes.body).toBeDefined()

      const reader = slowRes.body.getReader()
      const decoder = new TextDecoder()
      let allData = ''
      let done = false
      while (!done) {
        const { value, done: isDone } = await reader.read()
        if (isDone) { done = true; break }
        allData += decoder.decode(value, { stream: !done })
      }

      expect(allData).toContain('start')
      expect(allData).toContain('middle')
      expect(allData).toContain('end')
    })

    it('should abort slow-start stream during 102 polling phase', async () => {
      const controller = new AbortController()
      // Abort after 150ms — after 102 response (~100ms), during poll wait
      setTimeout(() => controller.abort(), 150)

      try {
        await client.fetch('slow-stream-tool', { delay: 500, stream: true }, 'run', undefined, {
          signal: controller.signal,
        })
        expect.fail('Should have aborted during 102 polling')
      } catch (err: any) {
        expect(err.name).toMatch(/AbortError|Error/)
      }
    })
  })

  describe('LoadFrom + Immediate Tool Call', () => {
    afterAll(() => {
      ClientTools.items = {}
    })

    it('should discover tools via connect() + loadFrom() and call immediately', async () => {
      const srv = ClientTools.connect(apiRoot)

      // loadFrom with no items triggers server discovery
      await srv.loadFrom(undefined, { apiUrl: apiRoot })

      const echo = srv.get('echo')
      expect(echo).toBeDefined()
      expect(echo.apiUrl).toBe(apiRoot)

      const result = await echo.run({ msg: 'connect-loadfrom' })
      expect(result).toBe('connect-loadfrom')
    })

    it('should discover multiple tools and call them all', async () => {
      const srv = ClientTools.connect(apiRoot)
      await srv.loadFrom(undefined, { apiUrl: apiRoot })

      const [echoResult, calcResult] = await Promise.all([
        srv.get('echo')!.run({ msg: 'multi' }),
        srv.get('calc')!.run({ a: 40, b: 2 }),
      ])
      expect(echoResult).toBe('multi')
      expect(calcResult).toBe(42)
    })

    it('should preserve metadata (timeout, params) from discovery', async () => {
      const srv = ClientTools.connect(apiRoot)
      await srv.loadFrom(undefined, { apiUrl: apiRoot })

      const calc = srv.get('calc')! as any
      expect(calc.timeout).toBe(5000)
      expect(calc.params).toBeDefined()
      expect(calc.params.a).toBeDefined()
      expect(calc.params.b).toBeDefined()

      const composer = srv.get('composer')! as any
      expect(composer.timeout).toBe(3000)
    })

    it('should support cascading tool calls via runAs', async () => {
      const srv = ClientTools.connect(apiRoot)
      await srv.loadFrom(undefined, { apiUrl: apiRoot })

      const composer = srv.get('composer')!
      const result = await composer.run({ x: 7, y: 8, label: 'sum' })
      expect(result).toEqual({ label: 'sum', sum: 15 })
    })

    it('should isolate discovered tools between connected services', async () => {
      const srv1 = ClientTools.connect(apiRoot)
      const srv2 = ClientTools.connect(apiRoot)

      await srv1.loadFrom(undefined, { apiUrl: apiRoot })
      await srv2.loadFrom(undefined, { apiUrl: apiRoot })

      // Both should have tools registered
      expect(srv1.get('echo')).toBeDefined()
      expect(srv2.get('echo')).toBeDefined()

      // Tools on different services should be independent instances
      const echo1 = srv1.get('echo')!
      const echo2 = srv2.get('echo')!
      expect(echo1).not.toBe(echo2)

      // Both should work independently
      const [r1, r2] = await Promise.all([
        echo1.run({ msg: 'from-srv1' }),
        echo2.run({ msg: 'from-srv2' }),
      ])
      expect(r1).toBe('from-srv1')
      expect(r2).toBe('from-srv2')
    })

    it('should work with .with({ apiUrl }) after discovery', async () => {
      const srv = ClientTools.connect(apiRoot)
      await srv.loadFrom(undefined, { apiUrl: apiRoot })

      const echo = srv.get('echo')!
      const result = await echo.with({ apiUrl: apiRoot }).run({ msg: 'dynamic-binding' })
      expect(result).toBe('dynamic-binding')
    })
  })
})
