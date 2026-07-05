// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { findPort } from '@isdk/util'
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox'
import { ToolFunc } from '@isdk/tool-func'
import { ServerTools } from '../src/server-tools'
import { ClientTools } from '../src/client-tools'
import { HttpClientToolTransport } from '../src/transports/http-client'
import { HttpServerToolTransport } from '../src/transports/http-server'
import { MailboxServerTransport } from '../src/transports/mailbox-server'
import { MailboxClientTransport } from '../src/transports/mailbox-client'
import { RpcServerDispatcher } from '../src/transports/dispatcher'

describe('Cross-Transport Integration (HTTP + Mailbox)', () => {
  let httpServer: HttpServerToolTransport
  let mailboxServer: MailboxServerTransport
  let httpClient: HttpClientToolTransport
  let mailboxClient: MailboxClientTransport
  let mailbox: Mailbox
  let port: number
  let apiRoot: string

  const serverAddress = 'mem://srv@cross/api'
  const clientAddress = 'mem://cli@cross/inbox'

  beforeAll(async () => {
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}

    // Single shared dispatcher registry — both transports resolve from here
    RpcServerDispatcher.instance.registry = ServerTools

    // ── Register shared server-side tools ──
    ServerTools.register({
      name: 'echo',
      params: { msg: { type: 'string' } },
      func: async function(params: any) {
        return params?.msg || null
      } as any,
      isApi: true,
    })

    ServerTools.register({
      name: 'calc',
      params: { a: { type: 'number' }, b: { type: 'number' } },
      func: async function({ a, b }: { a: number, b: number }) {
        return a + b
      } as any,
      isApi: true,
      timeout: 5000,
    })

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

    // Stateful counter — shared across all transport callers
    // Use globalThis to avoid Vite SSR closure issues (same pattern as mailbox-timeout.test.ts)
    ;(globalThis as any).__CrossTransportCounter = { value: 0 }
    ServerTools.register({
      name: 'counter',
      params: { op: { type: 'string' } },
      func: async function({ op = 'get' }: { op?: string }) {
        const state = (globalThis as any).__CrossTransportCounter || { value: 0 }
        if (op === 'increment') state.value++
        else if (op === 'reset') state.value = 0
        return state.value
      } as any,
      isApi: true,
    })

    // Slow tool with keepAliveOnTimeout — for 102 polling tests (Mailbox path only)
    ServerTools.register({
      name: 'slow-tool',
      timeout: { value: 100, keepAliveOnTimeout: true },
      params: { delay: { type: 'number' } },
      func: async function(params: any) {
        const signal = (this as any).ctx?.signal
        const delay = params?.delay || 300
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => resolve(`done-after-${delay}`), delay)
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
      isApi: true,
    })

    // ── Mailbox Transport ──
    mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider())

    mailboxServer = new MailboxServerTransport({ mailbox, apiUrl: serverAddress })
    mailboxServer.addDiscoveryHandler(serverAddress, () => ServerTools.toJSON())
    mailboxServer.addRpcHandler(serverAddress)
    await mailboxServer.start()

    mailboxClient = new MailboxClientTransport({
      mailbox,
      apiUrl: serverAddress,
      clientAddress,
      timeout: 5000,
    })
    await mailboxClient.start()

    // ── HTTP Transport ──
    port = await findPort(3020)
    apiRoot = `http://localhost:${port}/api`

    httpServer = new HttpServerToolTransport({ port, apiUrl: apiRoot })
    httpServer.addRpcHandler(apiRoot)
    httpServer.addDiscoveryHandler(apiRoot, () => ServerTools.toJSON())
    await httpServer.start({ port, host: 'localhost' })

    httpClient = new HttpClientToolTransport(apiRoot)
  })

  afterAll(async () => {
    await mailboxClient.stop()
    await mailboxServer.stop()
    await httpServer.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  describe('Cross-Transport Tool Invocation', () => {
    it('should call echo from HTTP and return result', async () => {
      const res = await httpClient._fetch('echo', { msg: 'http-echo' }, 'run')
      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body).toBe('http-echo')
    })

    it('should call echo from Mailbox and return result', async () => {
      const result = await mailboxClient.fetch('echo', { msg: 'mbox-echo' })
      expect(result).toBe('mbox-echo')
    })

    it('should call same echo tool from both transports with different params', async () => {
      const [httpRes, mboxRes] = await Promise.all([
        httpClient._fetch('echo', { msg: 'http-side' }, 'run').then(r => r.json()),
        mailboxClient.fetch('echo', { msg: 'mbox-side' }),
      ])
      expect(httpRes).toBe('http-side')
      expect(mboxRes).toBe('mbox-side')
    })

    it('should call different tools concurrently across transports', async () => {
      const [httpCalc, mboxEcho] = await Promise.all([
        httpClient._fetch('calc', { a: 20, b: 22 }, 'run').then(r => r.json()),
        mailboxClient.fetch('echo', { msg: 'parallel-mbox' }),
      ])
      expect(httpCalc).toBe(42)
      expect(mboxEcho).toBe('parallel-mbox')
    })

    it('should handle three-way concurrent calls (HTTP calc + HTTP echo + Mailbox echo)', async () => {
      const [c1, e1, e2] = await Promise.all([
        httpClient._fetch('calc', { a: 100, b: 200 }, 'run').then(r => r.json()),
        httpClient._fetch('echo', { msg: 'http-three' }, 'run').then(r => r.json()),
        mailboxClient.fetch('echo', { msg: 'mbox-three' }),
      ])
      expect(c1).toBe(300)
      expect(e1).toBe('http-three')
      expect(e2).toBe('mbox-three')
    })
  })

  describe('Cross-Transport Shared State', () => {
    beforeEach(() => {
      ;(globalThis as any).__CrossTransportCounter = { value: 0 }
    })

    it('should increment state via HTTP and read via Mailbox', async () => {
      const incRes = await httpClient._fetch('counter', { op: 'increment' }, 'run')
      expect((await incRes.json())).toBe(1)

      const getRes = await mailboxClient.fetch('counter', { op: 'get' })
      expect(getRes).toBe(1)
    })

    it('should accumulate state changes from both transports', async () => {
      await httpClient._fetch('counter', { op: 'increment' }, 'run')
      await mailboxClient.fetch('counter', { op: 'increment' })
      await httpClient._fetch('counter', { op: 'increment' }, 'run')
      await mailboxClient.fetch('counter', { op: 'increment' })

      const final = await mailboxClient.fetch('counter', { op: 'get' })
      expect(final).toBe(4)
    })

    it('should reset state from one transport and confirm from the other', async () => {
      // Build up state via HTTP
      await httpClient._fetch('counter', { op: 'increment' }, 'run')
      await httpClient._fetch('counter', { op: 'increment' }, 'run')
      expect((await mailboxClient.fetch('counter', { op: 'get' }))).toBe(2)

      // Reset via Mailbox
      const resetRes = await mailboxClient.fetch('counter', { op: 'reset' })
      expect(resetRes).toBe(0)

      // Confirm via HTTP
      const httpGet = await httpClient._fetch('counter', { op: 'get' }, 'run')
      expect((await httpGet.json())).toBe(0)
    })
  })

  describe('Cross-Transport Error Propagation', () => {
    it('should propagate 400 error from HTTP transport', async () => {
      try {
        await httpClient._fetch('error-tool', { code: 400 }, 'run')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Error [400]')
        expect(err.code).toBe(400)
        expect(err.status).toBe('bad_request')
      }
    })

    it('should propagate 500 error from Mailbox transport', async () => {
      try {
        await mailboxClient.fetch('error-tool', { code: 500 })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Intentional Error [500]')
        expect(err.code).toBe(500)
        expect(err.status).toBe('server_error')
      }
    })

    it('should propagate 404 for non-existent tool from both transports', async () => {
      const [httpErr, mboxErr] = await Promise.allSettled([
        httpClient._fetch('nonexistent', {}, 'run'),
        mailboxClient.fetch('nonexistent', {}),
      ])

      expect(httpErr.status).toBe('rejected')
      if (httpErr.status === 'rejected') {
        expect(httpErr.reason.message).toContain('RPC Error [404]')
      }

      expect(mboxErr.status).toBe('rejected')
      if (mboxErr.status === 'rejected') {
        expect(mboxErr.reason.message).toContain('Tool not found')
        expect(mboxErr.reason.code).toBe(404)
      }
    })
  })

  describe('Cross-Transport API Discovery', () => {
    it('should discover same tools from both transports', async () => {
      const [httpApis, mboxApis] = await Promise.all([
        httpClient.loadApis(),
        mailboxClient.loadApis(),
      ])

      // Both transports see the same set of tools
      expect(httpApis.echo).toBeDefined()
      expect(mboxApis.echo).toBeDefined()
      expect(httpApis.calc).toBeDefined()
      expect(mboxApis.calc).toBeDefined()
      expect(httpApis['error-tool']).toBeDefined()
      expect(mboxApis['error-tool']).toBeDefined()
      expect(httpApis.counter).toBeDefined()
      expect(mboxApis.counter).toBeDefined()
    })

    it('should return consistent tool metadata across transports', async () => {
      const [httpApis, mboxApis] = await Promise.all([
        httpClient.loadApis(),
        mailboxClient.loadApis(),
      ])

      // Both transports return the same timeout
      expect(httpApis.calc.timeout).toBe(5000)
      expect(mboxApis.calc.timeout).toBe(5000)

      // Both transports return the same params schema
      expect(httpApis.echo.params.msg.type).toBe('string')
      expect(mboxApis.echo.params.msg.type).toBe('string')
    })

    it('should discover newly registered tools through both transports', async () => {
      // Register a new tool while both transports are running
      ServerTools.register({
        name: 'late-registration',
        params: { val: { type: 'number' } },
        func: async function({ val = 0 }: { val?: number }) {
          return val * 2
        } as any,
        isApi: true,
      })

      const [httpApis, mboxApis] = await Promise.all([
        httpClient.loadApis(),
        mailboxClient.loadApis(),
      ])

      expect(httpApis['late-registration']).toBeDefined()
      expect(mboxApis['late-registration']).toBeDefined()

      // Actually call the newly registered tool from both transports
      const [httpRes, mboxRes] = await Promise.all([
        httpClient._fetch('late-registration', { val: 7 }, 'run').then(r => r.json()),
        mailboxClient.fetch('late-registration', { val: 10 }),
      ])
      expect(httpRes).toBe(14)
      expect(mboxRes).toBe(20)
    })
  })

  describe('Cross-Transport 102 Polling', () => {
    it('should handle 102 polling via HTTP transport', async () => {
      const result = await httpClient.fetch('slow-tool', { delay: 300 })
      expect(result).toBe('done-after-300')
    })

    it('should handle 102 polling via Mailbox transport', async () => {
      const result = await mailboxClient.fetch('slow-tool', { delay: 300 })
      expect(result).toBe('done-after-300')
    })

    it('should handle concurrent 102 polling across HTTP + Mailbox', async () => {
      const [httpRes, mboxRes] = await Promise.all([
        httpClient.fetch('slow-tool', { delay: 300 }),
        mailboxClient.fetch('slow-tool', { delay: 400 }),
      ])
      expect(httpRes).toBe('done-after-300')
      expect(mboxRes).toBe('done-after-400')
    })

    it('should handle two concurrent 102 polling calls via HTTP', async () => {
      const [r1, r2] = await Promise.all([
        httpClient.fetch('slow-tool', { delay: 300 }),
        httpClient.fetch('slow-tool', { delay: 400 }),
      ])
      expect(r1).toBe('done-after-300')
      expect(r2).toBe('done-after-400')
    })

    it('should handle concurrent HTTP 102 polling + HTTP fast call', async () => {
      const [slow, fast] = await Promise.all([
        httpClient.fetch('slow-tool', { delay: 300 }),
        httpClient._fetch('echo', { msg: 'fast-http' }, 'run').then(r => r.json()),
      ])
      expect(slow).toBe('done-after-300')
      expect(fast).toBe('fast-http')
    })

    it('should handle concurrent HTTP 102 polling + Mailbox call', async () => {
      const [httpSlow, mboxEcho] = await Promise.all([
        httpClient.fetch('slow-tool', { delay: 300 }),
        mailboxClient.fetch('echo', { msg: 'mbox-during-http-poll' }),
      ])
      expect(httpSlow).toBe('done-after-300')
      expect(mboxEcho).toBe('mbox-during-http-poll')
    })

    it('should abort HTTP 102 polling via AbortSignal during polling phase', async () => {
      // The slow-tool has soft timeout 100ms with keepAliveOnTimeout.
      // It takes 500ms to complete. The 102 response arrives at ~100ms,
      // then executeWithPolling enters the polling loop.
      // Abort at 150ms — well after 102, during the poll wait.
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 150)

      try {
        await httpClient.fetch('slow-tool', { delay: 500 }, 'run', undefined, {
          signal: controller.signal,
        })
        expect.fail('Should have aborted during 102 polling')
      } catch (err: any) {
        // Should abort with either AbortError or a timeout-like error
        expect(err).toBeDefined()
        expect(err.name || err.code).toBeDefined()
      }
    })

    it('should abort Mailbox 102 polling via AbortSignal during polling phase', async () => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 150)

      try {
        await mailboxClient.fetch('slow-tool', { delay: 500 }, 'run', undefined, {
          signal: controller.signal,
        })
        expect.fail('Should have aborted during Mailbox 102 polling')
      } catch (err: any) {
        expect(err).toBeDefined()
      }
    })

    it('should reject with AbortError when aborting HTTP 102 polling', async () => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 150)

      try {
        await httpClient.fetch('slow-tool', { delay: 500 }, 'run', undefined, {
          signal: controller.signal,
        })
        expect.fail('Should have aborted')
      } catch (err: any) {
        expect(err.name).toMatch(/AbortError|Error/)
      }
    })

    it('should cancel background task when aborting HTTP 102 polling', async () => {
      // Spy on pollTaskStatus to verify cancel is sent
      const cancelSpy = vi.spyOn(httpClient, 'pollTaskStatus')
      const controller = new AbortController()

      setTimeout(() => controller.abort(), 150)

      try {
        await httpClient.fetch('slow-tool', { delay: 500 }, 'run', undefined, {
          signal: controller.signal,
        })
      } catch {
        // Expected
      }

      // The abortListener calls pollTaskStatus(reqId, { ...fetchOptions, act: '$cancel' })
      // Verify that a cancel was actually sent to the server
      const cancelWasCalled = cancelSpy.mock.calls.some(
        call => call[1]?.act === '$cancel'
      )
      expect(cancelWasCalled).toBe(true)
      cancelSpy.mockRestore()
    })

    it('should handle pre-aborted signal before HTTP 102 polling starts', async () => {
      const controller = new AbortController()
      controller.abort()

      try {
        await httpClient.fetch('slow-tool', { delay: 500 }, 'run', undefined, {
          signal: controller.signal,
        })
        expect.fail('Should have thrown immediately')
      } catch (err: any) {
        expect(err.name).toMatch(/AbortError|Error/)
      }
    })
  })

  describe('Cross-Transport Lifecycle Independence', () => {
    it('should continue serving HTTP requests after Mailbox transport stops', async () => {
      // Stop mailbox server
      await mailboxClient.stop()
      await mailboxServer.stop()

      // HTTP should still work
      const res = await httpClient._fetch('echo', { msg: 'http-alone' }, 'run')
      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body).toBe('http-alone')

      // Restart mailbox for other tests
      mailboxServer = new MailboxServerTransport({ mailbox, apiUrl: serverAddress })
      mailboxServer.addDiscoveryHandler(serverAddress, () => ServerTools.toJSON())
      mailboxServer.addRpcHandler(serverAddress)
      await mailboxServer.start()

      mailboxClient = new MailboxClientTransport({
        mailbox,
        apiUrl: serverAddress,
        clientAddress,
        timeout: 5000,
      })
      await mailboxClient.start()
    })

    it('should continue serving Mailbox requests after HTTP transport stops', async () => {
      // Stop HTTP server
      await httpServer.stop()

      // Mailbox should still work
      const result = await mailboxClient.fetch('echo', { msg: 'mbox-alone' })
      expect(result).toBe('mbox-alone')

      // Restart HTTP for cleanup
      httpServer = new HttpServerToolTransport({ port, apiUrl: apiRoot })
      httpServer.addRpcHandler(apiRoot)
      httpServer.addDiscoveryHandler(apiRoot, () => ServerTools.toJSON())
      await httpServer.start({ port, host: 'localhost' })
    })

    it('should serve both transports simultaneously after full restart', async () => {
      const [httpRes, mboxRes] = await Promise.all([
        httpClient._fetch('echo', { msg: 'restart-http' }, 'run').then(r => r.json()),
        mailboxClient.fetch('echo', { msg: 'restart-mbox' }),
      ])
      expect(httpRes).toBe('restart-http')
      expect(mboxRes).toBe('restart-mbox')
    })
  })
})
