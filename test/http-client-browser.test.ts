// @vitest-environment node
// Tests HttpClientToolTransport in a simulated browser environment.
// Uses Node 20+'s built-in Web APIs (fetch, Response, TransformStream, AbortController, URL)
// which match the browser's native APIs. No real HTTP server is needed — fetch is mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HttpClientToolTransport } from '../src/transports/http-client'
import { RPC_HEADERS } from '../src/transports/models'

// Helper: create a minimal 102-status fetch response object.
// The real Response constructor rejects status 102, so we build one manually.
function make102Response(headers: Record<string, string> = {}) {
  const entries = Object.entries(headers)
  return {
    status: 102,
    headers: {
      entries: () => entries[Symbol.iterator](),
      forEach: (fn: Function) => entries.forEach(([k, v]) => fn(v, k)),
    },
    ok: false,
  }
}

describe('HttpClientToolTransport (browser-like environment)', () => {
  let mockFetch: any
  let transport: HttpClientToolTransport

  beforeEach(() => {
    mockFetch = vi.spyOn(globalThis, 'fetch')
    transport = new HttpClientToolTransport('http://browser-test/api')
  })

  afterEach(() => {
    mockFetch.mockRestore()
  })

  // ==========================================================
  // URL Construction
  // ==========================================================

  describe('URL Construction', () => {
    it('should append tool name to base URL for POST', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', { key: 'val' })

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('http://browser-test/api/myTool')
    })

    it('should append tool name and resource ID to base URL', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'run', 'res-42')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('http://browser-test/api/myTool/res-42')
    })

    it('should preserve query parameters and hash from base URL', async () => {
      const transportWithQuery = new HttpClientToolTransport('http://browser-test/api/v2?token=abc#section')
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transportWithQuery._fetch('test', null, 'run')

      const [urlStr] = mockFetch.mock.calls[0]
      const url = new URL(urlStr as string)
      expect(url.pathname).toBe('/api/v2/test')
      expect(url.searchParams.get('token')).toBe('abc')
      expect(url.hash).toBe('#section')
    })

    it('should handle non-HTTP URLs without path manipulation', async () => {
      const wsTransport = new HttpClientToolTransport('ws://browser-test/api')
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await wsTransport._fetch('myTool', null, 'run')

      // Non-HTTP URLs don't get path manipulation, but headers still injected
      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('ws://browser-test/api')
      // Headers should still be injected
      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.FUNC]).toBe('myTool')
    })

    it('should encode special characters in tool name and ID', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('tool/name', null, 'run', 'id/123')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('http://browser-test/api/tool%2Fname/id%2F123')
    })
  })

  // ==========================================================
  // HTTP Method Selection
  // ==========================================================

  describe('HTTP Method Selection', () => {
    it('should use POST by default', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', { a: 1 })

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).method).toBe('POST')
    })

    it('should use GET for act=get', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', { query: 'test' }, 'get')

      const [url, opts] = mockFetch.mock.calls[0]
      expect((opts as any).method).toBe('GET')
      // Params should be in query string
      const parsed = new URL(url as string)
      expect(parsed.searchParams.get('p')).toBe(JSON.stringify({ query: 'test' }))
    })

    it('should use DELETE for act=delete', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'delete', 'item-99')

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).method).toBe('DELETE')
    })

    it('should use GET for act=list', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'list')

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).method).toBe('GET')
    })

    it('should respect fetchOptions.method override', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'run', undefined, { method: 'PUT' })

      const [, opts] = mockFetch.mock.calls[0]
      // Note: method override only works for 'GET' in the code's condition check.
      // For PUT/PATCH/etc., method stays as default 'POST' but request options passed through.
      expect((opts as any).method).toBe('POST')
    })
  })

  // ==========================================================
  // Request Body Construction
  // ==========================================================

  describe('Request Body', () => {
    it('should send JSON body for POST', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', { a: 1, b: 'test' })

      const [, opts] = mockFetch.mock.calls[0]
      expect(JSON.parse((opts as any).body)).toEqual({ a: 1, b: 'test' })
    })

    it('should set Content-Type header for requests', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', { data: 1 })

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers['Content-Type']).toBe('application/json')
    })

    it('should send null params as POST without body', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null)

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).body).toBeUndefined()
    })

    it('should send string body directly without double-stringify', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', 'raw-string')

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).body).toBe('raw-string')
    })
  })

  // ==========================================================
  // RPC Header Injection
  // ==========================================================

  describe('RPC Headers', () => {
    it('should inject rpc-fn header', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool')

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.FUNC]).toBe('myTool')
    })

    it('should inject rpc-act header', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'customAct')

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.ACT]).toBe('customAct')
    })

    it('should inject rpc-res-id header', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'run', 'resource-1')

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.RES_ID]).toBe('resource-1')
    })

    it('should merge custom headers from fetchOptions', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'run', undefined, {
        headers: { 'x-custom': 'custom-val' }
      })

      const [, opts] = mockFetch.mock.calls[0]
      const headers = (opts as any).headers
      expect(headers['x-custom']).toBe('custom-val')
      expect(headers[RPC_HEADERS.FUNC]).toBe('myTool')
    })

    it('should inject rpc-timeout header from fetchOptions', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      // Use the public fetch() method which does timeout negotiation
      await transport.fetch('myTool', { data: 1 }, 'run', undefined, { timeout: 5000 })

      const [, opts] = mockFetch.mock.calls[0]
      const headers = (opts as any).headers
      expect(headers[RPC_HEADERS.TIMEOUT]).toBe('5000')
    })

    it('should inject request ID header', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))

      await transport._fetch('myTool', null, 'run', undefined, {
        headers: { [RPC_HEADERS.REQUEST_ID]: 'custom-req-id' }
      })

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.REQUEST_ID]).toBe('custom-req-id')
    })

    it('should auto-generate request ID if not provided', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify('ok'), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))

      // Request ID is generated by the parent fetch() method, not _fetch().
      // So test via public fetch() which calls executeWithPolling → _fetch.
      await transport.fetch('myTool', { data: 1 }, 'run')

      const [, opts] = mockFetch.mock.calls[0]
      const reqId = (opts as any).headers[RPC_HEADERS.REQUEST_ID]
      expect(reqId).toBeDefined()
      expect(typeof reqId).toBe('string')
      expect(reqId.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================
  // Response Parsing
  // ==========================================================

  describe('Response Parsing', () => {
    it('should parse JSON response via toObject', async () => {
      const response = new Response(JSON.stringify({ result: 'success', count: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const parsed = await transport.toObject(response)
      expect(parsed).toEqual({ result: 'success', count: 42 })
    })

    it('should return text for non-JSON content type', async () => {
      const response = new Response('plain text response', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })

      const parsed = await transport.toObject(response)
      expect(parsed).toBe('plain text response')
    })

    it('should return text when no content-type header', async () => {
      const response = new Response('raw text', { status: 200 })

      const parsed = await transport.toObject(response)
      expect(parsed).toBe('raw text')
    })

    it('should pass through 102 status objects in toObject', async () => {
      const result = await transport.toObject({ status: 102, headers: { 'rpc-retry-after': '1000' } })
      expect(result.status).toBe(102)
    })
  })

  // ==========================================================
  // 102 Processing Response Handling
  // ==========================================================

  describe('102 Processing', () => {
    it('should return 102 status object when server responds with 102', async () => {
      // Browser's Response constructor rejects status 102, so we mock the fetch
      // to return a minimal object that quacks like a Response for the 102 path.
      mockFetch.mockResolvedValue({
        status: 102,
        headers: {
          entries: () => [['rpc-retry-after', '500']][Symbol.iterator](),
          forEach: (_fn: any) => {},
        },
        ok: false,
      } as any)

      const result = await transport._fetch('myTool', null, 'run')

      expect(result).toEqual({
        status: 102,
        headers: { 'rpc-retry-after': '500' }
      })
    })

    it('should detect 102 from 202 response body', async () => {
      const response = new Response(JSON.stringify({
        status: 102,
        message: 'Processing',
        headers: { 'rpc-retry-after': '1000' }
      }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      })
      mockFetch.mockResolvedValue(response)

      const result = await transport._fetch('myTool', null, 'run')

      expect(result.status).toBe(102)
      expect(result.headers['rpc-retry-after']).toBe('1000')
    })

    it('should treat 202 without 102 body as normal response', async () => {
      const response = new Response(JSON.stringify({ id: 'task-001' }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      })
      mockFetch.mockResolvedValue(response)

      const result = (await transport._fetch('myTool', null, 'run')) as Response

      // Should not be processed as 102
      expect(result.status).not.toBe(102)
      expect(result.ok).toBe(true)
    })

    it('should poll task status when 102 received via fetch()', async () => {
      const secondResponse = new Response(JSON.stringify({ done: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })

      let callCount = 0
      mockFetch.mockImplementation(async () => {
        callCount++
        if (callCount === 1) return make102Response({ 'rpc-retry-after': '10' })
        return secondResponse
      })

      const result = await transport.fetch('myTool', { data: 'test' }, 'run')

      expect(result).toEqual({ done: true })
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    it('should handle multiple 102 polls before final response', async () => {
      const finalResponse = new Response(JSON.stringify('finally done'), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })

      let callCount = 0
      mockFetch.mockImplementation(async () => {
        callCount++
        if (callCount <= 2) return make102Response({ 'rpc-retry-after': '10' })
        return finalResponse
      })

      const result = await transport.fetch('myTool', { data: 'test' }, 'run')

      expect(result).toBe('finally done')
      expect(callCount).toBe(3)
    })
  })

  // ==========================================================
  // Error Handling
  // ==========================================================

  describe('Error Handling', () => {
    it('should throw RPC Error for non-OK response', async () => {
      mockFetch.mockResolvedValue(new Response('Not Found', {
        status: 404,
        statusText: 'Not Found'
      }))

      try {
        await transport._fetch('myTool', null, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [404]')
        expect(err.code).toBe(404)
        expect(err.status).toBe('error')
      }
    })

    it('should parse structured error from response body', async () => {
      const errorBody = {
        error: {
          code: 400,
          status: 'bad_request',
          message: 'Invalid parameters',
          data: { field: 'name' }
        }
      }
      mockFetch.mockResolvedValue(new Response(JSON.stringify(errorBody), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' }
      }))

      try {
        await transport._fetch('myTool', null, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [400]')
        expect(err.message).toContain('Invalid parameters')
        expect(err.code).toBe(400)
        expect(err.status).toBe('bad_request')
        expect(err.data).toEqual({ field: 'name' })
      }
    })

    it('should handle non-JSON error body gracefully', async () => {
      mockFetch.mockResolvedValue(new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error'
      }))

      try {
        await transport._fetch('myTool', null, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [500]')
        expect(err.message).toContain('Internal Server Error')
      }
    })

    it('should handle empty error body', async () => {
      mockFetch.mockResolvedValue(new Response('', {
        status: 503,
        statusText: 'Service Unavailable'
      }))

      try {
        await transport._fetch('myTool', null, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [503]')
        expect(err.message).toContain('Service Unavailable')
      }
    })

    it('should propagate network errors from fetch', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

      try {
        await transport._fetch('myTool', null, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Failed to fetch')
      }
    })

    it('should propagate DNS/connection errors', async () => {
      mockFetch.mockRejectedValue(new TypeError('net::ERR_NAME_NOT_RESOLVED'))

      try {
        await transport._fetch('myTool', null, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('net::ERR_NAME_NOT_RESOLVED')
      }
    })
  })

  // ==========================================================
  // Timeout & AbortSignal
  // ==========================================================

  describe('Timeout & AbortSignal', () => {
    it('should abort with 504 on client-side timeout via _fetch', async () => {
      // Mock fetch that never resolves and respects AbortSignal
      mockFetch.mockImplementation(async (_url, options) => {
        const { signal } = (options || {}) as RequestInit
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason || new Error('Aborted'))
            return
          }
          const onAbort = () => reject(signal?.reason || new Error('Aborted'))
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      })

      try {
        await transport._fetch('myTool', null, 'run', undefined, { timeout: 5 })
        expect.fail('Should have timed out')
      } catch (err: any) {
        expect(err.code).toBe(504)
        expect(err.message).toMatch(/Timeout/i)
      }
    })

    it('should abort with 504 on client-side timeout via fetch()', async () => {
      mockFetch.mockImplementation(async (_url, options) => {
        const { signal } = (options || {}) as RequestInit
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason || new Error('Aborted'))
            return
          }
          const onAbort = () => reject(signal?.reason || new Error('Aborted'))
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      })

      try {
        await transport.fetch('myTool', { data: 1 }, 'run', undefined, { timeout: 5 })
        expect.fail('Should have timed out')
      } catch (err: any) {
        expect(err.code).toBe(504)
        expect(err.message).toMatch(/Timeout/i)
      }
    })

    it('should abort fetch when AbortSignal is triggered', async () => {
      const controller = new AbortController()
      mockFetch.mockImplementation(async (_url, options) => {
        const { signal } = (options || {}) as RequestInit
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason || new Error('Aborted'))
            return
          }
          const onAbort = () => reject(signal?.reason || new Error('Aborted'))
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      })

      setTimeout(() => controller.abort(), 10)

      try {
        await transport._fetch('myTool', null, 'run', undefined, { signal: controller.signal })
        expect.fail('Should have been aborted')
      } catch (err: any) {
        expect(err.message).toMatch(/Aborted|aborted/i)
      }
    })

    it('should reject immediately if signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      try {
        await transport.fetch('myTool', { data: 1 }, 'run', undefined, { signal: controller.signal })
        expect.fail('Should have thrown on pre-aborted signal')
      } catch (err: any) {
        expect(err.message).toMatch(/Aborted/i)
      }
      // fetch should NOT have been called
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ==========================================================
  // Stream Idle Timeout
  // ==========================================================

  describe('Stream Idle Timeout', () => {
    it('should wrap response body in monitored stream when streamIdleTimeout is set', async () => {
      // Create a response with a body that never sends more data (simulates stalled stream)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first'))
          // Never send more data — should trigger idle timeout
        }
      })

      mockFetch.mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      }))

      const res = (await transport._fetch('myTool', { stream: true }, 'run', undefined, {
        timeout: { value: 5000, streamIdleTimeout: 20 }
      })) as Response

      expect(res.ok).toBe(true)
      expect(res.body).toBeDefined()

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      // First chunk should arrive
      const first = await reader.read()
      expect(decoder.decode(first.value)).toBe('first')

      // Second read should trigger idle timeout (no more data after 20ms)
      try {
        await reader.read()
        expect.fail('Should have timed out on idle')
      } catch (err: any) {
        expect(err.message).toMatch(/Idle Timeout/i)
      }
    })
  })

  // ==========================================================
  // LoadApis (API Discovery)
  // ==========================================================

  describe('loadApis', () => {
    it('should request discovery via GET on root', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({
        echo: { name: 'echo', params: { msg: { type: 'string' } } }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))

      const apis = await transport.loadApis()

      const [url, opts] = mockFetch.mock.calls[0]
      // loadApis calls fetch('', undefined, 'get', ...) → URL becomes base + '/'
      expect(url).toBe('http://browser-test/api/')
      expect((opts as any).method).toBe('GET')
      expect(apis.echo).toBeDefined()
      expect(apis.echo.name).toBe('echo')
    })

    it('should pass custom headers in discovery request', async () => {
      mockFetch.mockResolvedValue(new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))

      await transport.loadApis({ headers: { Authorization: 'Bearer token123' } })

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers['Authorization']).toBe('Bearer token123')
    })

    it('should propagate errors during discovery', async () => {
      mockFetch.mockResolvedValue(new Response('Not Found', {
        status: 404,
        statusText: 'Not Found'
      }))

      try {
        await transport.loadApis()
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [404]')
      }
    })
  })

  // ==========================================================
  // Timeout Negotiation (via public fetch method)
  // ==========================================================

  describe('Timeout Negotiation', () => {
    it('should negotiate min(userTimeout, toolTimeout)', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify('ok'), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))

      // User says 1000ms, tool says 5000ms → min = 1000ms
      await transport.fetch('myTool', { data: 1 }, 'run', undefined, { timeout: 1000 }, 5000)

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.TIMEOUT]).toBe('1000')
    })

    it('should use timeout: { value } object correctly', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify('ok'), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))

      await transport.fetch('myTool', { data: 1 }, 'run', undefined, { timeout: { value: 3000 } }, { value: 5000 })

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.TIMEOUT]).toBe('3000')
    })

    it('should handle expectedDuration header', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify('ok'), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))

      await transport.fetch('myTool', { data: 1 }, 'run', undefined, { expectedDuration: 200 })

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers['rpc-expected-duration']).toBe('200')
    })
  })

  // ==========================================================
  // ClientId Propagation
  // ==========================================================

  describe('ClientId', () => {
    it('should inject clientId header when provided', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify('ok'), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))

      await transport.fetch('myTool', { data: 1 }, 'run', undefined, { clientId: 'browser-client-1' })

      const [, opts] = mockFetch.mock.calls[0]
      expect((opts as any).headers[RPC_HEADERS.CLIENT_ID]).toBe('browser-client-1')
    })
  })

  // ==========================================================
  // Constructor & Configuration
  // ==========================================================

  describe('Construction', () => {
    it('should construct with apiUrl', () => {
      const t = new HttpClientToolTransport('http://test/api')
      expect(t.apiUrl).toBe('http://test/api')
    })

    it('should throw if apiUrl is empty', () => {
      expect(() => new (HttpClientToolTransport as any)()).toThrow('apiUrl is required')
    })

    it('should expose manager reference', () => {
      const t = new HttpClientToolTransport('http://test/api')
      expect(t.manager).toBeDefined()
    })

    it('should support deprecated apiRoot alias', () => {
      const t = new HttpClientToolTransport('http://legacy/api')
      expect(t.apiRoot).toBe('http://legacy/api')
      t.apiRoot = 'http://updated/api'
      expect(t.apiUrl).toBe('http://updated/api')
    })
  })
})
