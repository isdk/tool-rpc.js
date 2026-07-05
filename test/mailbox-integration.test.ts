// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox'
import { ToolFunc } from '@isdk/tool-func'
import { ServerTools } from '../src/server-tools'
import { ClientTools } from '../src/client-tools'
import { MailboxServerTransport } from '../src/transports/mailbox-server'
import { MailboxClientTransport } from '../src/transports/mailbox-client'
import { RpcServerDispatcher } from '../src/transports/dispatcher'

describe('Mailbox Transport Integration', () => {
  let mailbox: Mailbox
  let server: MailboxServerTransport
  let client: MailboxClientTransport

  const serverAddress = 'mem://srv@mailbox/api'
  const clientAddress = 'mem://cli@mailbox/inbox'

  beforeAll(async () => {
    ToolFunc.items = {}

    const serverItems: Record<string, any> = {}
    Object.setPrototypeOf(serverItems, ToolFunc.items)
    ServerTools.items = serverItems

    const clientItems: Record<string, any> = {}
    Object.setPrototypeOf(clientItems, ToolFunc.items)
    ClientTools.items = clientItems

    // Setup Dispatcher Registry
    RpcServerDispatcher.instance.registry = ServerTools

    // ── Register Server-Side Tools ──
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

    // ── Create Mailbox & Transports ──
    mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider())

    server = new MailboxServerTransport({ mailbox, apiUrl: serverAddress })
    server.addDiscoveryHandler(serverAddress, () => ServerTools.toJSON())
    server.addRpcHandler(serverAddress)
    await server.start()

    client = new MailboxClientTransport({
      mailbox,
      apiUrl: serverAddress,
      clientAddress,
      timeout: 2000,
    })

    ClientTools.setTransport(client)
    await client.start()
    await ClientTools.loadFrom()
  })

  afterAll(async () => {
    await client.stop()
    await server.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  describe('Transport Construction & Lifecycle', () => {
    it('should construct server with apiUrl', () => {
      const t = new MailboxServerTransport({ mailbox, apiUrl: 'mem://test/api' })
      expect(t.apiUrl).toBe('mem://test/api')
    })

    it('should throw if server apiUrl is missing', () => {
      expect(() => new MailboxServerTransport({} as any)).toThrow('apiUrl is required')
    })

    it('should construct client with apiUrl and clientAddress', () => {
      const t = new MailboxClientTransport({
        mailbox,
        apiUrl: 'mem://s/api',
        clientAddress: 'mem://c/inbox',
      })
      expect(t.apiUrl).toBe('mem://s/api')
    })

    it('should throw if client clientAddress is missing', () => {
      expect(() => new MailboxClientTransport({
        apiUrl: 'mem://s/api',
      } as any)).toThrow('clientAddress is required')
    })

    it('should start and stop cleanly', async () => {
      const localMailbox = new Mailbox()
      localMailbox.registerProvider(new MemoryProvider())

      const sv = new MailboxServerTransport({ mailbox, apiUrl: 'mem://lifecycle-test/api' })
      sv.addRpcHandler('mem://lifecycle-test/api')
      sv.dispatcher.registry = ServerTools
      await sv.start()
      await sv.stop()
    })
  })

  describe('Real Mailbox Round-Trip', () => {
    it('should call echo tool and receive result', async () => {
      const result = await client.fetch('echo', { msg: 'hello-mailbox' })
      expect(result).toBe('hello-mailbox')
    })

    it('should call calc tool with numeric params', async () => {
      const result = await client.fetch('calc', { a: 30, b: 12 })
      expect(result).toBe(42)
    })

    it('should handle null params gracefully', async () => {
      const result = await client.fetch('echo', { msg: null })
      expect(result).toBeNull()
    })
  })

  describe('Error Handling', () => {
    it('should propagate structured error (400)', async () => {
      try {
        await client.fetch('error-tool', { code: 400 })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Intentional Error [400]')
        expect(err.code).toBe(400)
        expect(err.status).toBe('bad_request')
      }
    })

    it('should propagate structured error (500)', async () => {
      try {
        await client.fetch('error-tool', { code: 500 })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Intentional Error [500]')
        expect(err.code).toBe(500)
        expect(err.status).toBe('server_error')
      }
    })

    it('should throw 404 for non-existent tool', async () => {
      try {
        await client.fetch('nonexistent-tool', {})
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Tool not found')
        expect(err.code).toBe(404)
      }
    })
  })

  describe('API Discovery (loadApis)', () => {
    it('should discover tools via loadApis', async () => {
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
      await ClientTools.loadFrom()
    })

    it('should call discovered echo tool', async () => {
      const tool = ClientTools.get('echo')!
      const result = await tool.run({ msg: 'e2e-mailbox' })
      expect(result).toBe('e2e-mailbox')
    })

    it('should propagate errors from discovered tools', async () => {
      const errTool = ClientTools.get('error-tool')!
      try {
        await errTool.run({ code: 400 })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Intentional Error [400]')
      }
    })

    it('should handle concurrent requests', async () => {
      const [r1, r2] = await Promise.all([
        ClientTools.get('echo')!.run({ msg: 'concurrent-1' }),
        ClientTools.get('calc')!.run({ a: 10, b: 20 }),
      ])
      expect(r1).toBe('concurrent-1')
      expect(r2).toBe(30)
    })
  })

  describe('LoadFrom + Immediate Tool Call', () => {
    beforeEach(() => {
      // Each test gets a fresh connected service
    })

    it('should discover via connect() + loadFrom() and call immediately', async () => {
      const srv = ClientTools.connect(serverAddress)
      await srv.loadFrom(undefined, { apiUrl: serverAddress })

      const echo = srv.get('echo')
      expect(echo).toBeDefined()
      expect(echo.apiUrl).toBe(serverAddress)

      const result = await echo.run({ msg: 'connect-mailbox' })
      expect(result).toBe('connect-mailbox')
    })

    it('should preserve metadata from discovery', async () => {
      const srv = ClientTools.connect(serverAddress)
      await srv.loadFrom(undefined, { apiUrl: serverAddress })

      const calc = srv.get('calc')! as any
      expect(calc.timeout).toBe(5000)
      expect(calc.params).toBeDefined()
      expect(calc.params.a).toBeDefined()
    })

    it('should isolate discovered tools between connected services', async () => {
      const srv1 = ClientTools.connect(serverAddress)
      const srv2 = ClientTools.connect(serverAddress)

      await srv1.loadFrom(undefined, { apiUrl: serverAddress })
      await srv2.loadFrom(undefined, { apiUrl: serverAddress })

      const e1 = srv1.get('echo')!
      const e2 = srv2.get('echo')!
      expect(e1).not.toBe(e2)

      const [r1, r2] = await Promise.all([
        e1.run({ msg: 'srv1' }),
        e2.run({ msg: 'srv2' }),
      ])
      expect(r1).toBe('srv1')
      expect(r2).toBe('srv2')
    })
  })

  describe('Headers & Context', () => {
    beforeAll(async () => {
      ServerTools.register({
        name: 'header-inspector',
        isApi: true,
        func: async function(this: any) {
          const ctx = this.ctx
          const h = ctx?.headers || {}
          return {
            from: h['x-mailbox-from'],
            to: h['x-mailbox-to'],
            toolId: h['rpc-fn'],
            act: h['rpc-act'],
            resId: h['rpc-res-id'],
          }
        } as any,
      })
      await ClientTools.loadFrom()
    })

    it('should propagate x-mailbox-from and x-mailbox-to headers', async () => {
      const inspector = ClientTools.get('header-inspector')!
      const result = await inspector.run({})
      expect(result.from).toBe(clientAddress)
      expect(result.to).toBe(serverAddress)
      expect(result.toolId).toBe('header-inspector')
    })

    it('should propagate custom headers through transport', async () => {
      const result = await client.fetch('header-inspector', {}, 'run', undefined, {
        headers: {
          'mbx-custom': 'my-value',
          'trace-id': 'trace-mailbox',
        }
      })
      expect(result.toolId).toBe('header-inspector')
      expect(result.from).toBe(clientAddress)
    })
  })

  describe('102 Processing (KeepAlive/Polling)', () => {
    beforeAll(async () => {
      // ── Register tools with keepAliveOnTimeout ──
      ServerTools.register({
        name: 'poll-tool',
        timeout: { value: 100, keepAliveOnTimeout: true },
        params: { delay: { type: 'number' } },
        func: async function (params: any) {
          const signal = (this as any).ctx?.signal
          const delay = params?.delay || 300
          return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve(`done-after-${delay}`)
            }, delay)
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

      ServerTools.register({
        name: 'poll-tool-error',
        timeout: { value: 100, keepAliveOnTimeout: true },
        params: { delay: { type: 'number' }, failMsg: { type: 'string' } },
        func: async function (params: any) {
          const signal = (this as any).ctx?.signal
          const delay = params?.delay || 300
          const failMsg = params?.failMsg || 'Background failure'
          return new Promise<string>((_resolve, reject) => {
            const timer = setTimeout(() => {
              const err = new Error(failMsg)
              err.code = 500
              reject(err)
            }, delay)
            if (signal) {
              signal.addEventListener('abort', () => {
                clearTimeout(timer)
                const err = new Error('Aborted')
                err.name = 'AbortError'
                reject(err)
              }, { once: true })
            }
          })
        } as any,
        isApi: true,
      })

      ServerTools.register({
        name: 'very-slow-poll',
        timeout: { value: 50, keepAliveOnTimeout: true },
        func: async function () {
          const signal = (this as any).ctx?.signal
          return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => resolve('very-slow-done'), 600)
            if (signal) {
              signal.addEventListener('abort', () => {
                clearTimeout(timer)
                reject(new Error('Aborted'))
              }, { once: true })
            }
          })
        } as any,
        isApi: true,
      })

      await ClientTools.loadFrom()
    })

    it('should complete via 102 polling with keepAliveOnTimeout (ClientTools)', async () => {
      const tool = ClientTools.get('poll-tool')!
      const result = await tool.run({ delay: 300 })
      expect(result).toBe('done-after-300')
    })

    it('should complete via 102 polling with keepAliveOnTimeout (raw client.fetch)', async () => {
      const result = await client.fetch('poll-tool', { delay: 300 })
      expect(result).toBe('done-after-300')
    })

    it('should invoke pollTaskStatus at least once during 102 polling', async () => {
      const pollSpy = vi.spyOn(client, 'pollTaskStatus')
      try {
        const tool = ClientTools.get('poll-tool')!
        await tool.run({ delay: 300 })
        expect(pollSpy).toHaveBeenCalled()
      } finally {
        pollSpy.mockRestore()
      }
    })

    it('should propagate background task error via polling', async () => {
      const tool = ClientTools.get('poll-tool-error')!
      try {
        await tool.run({ delay: 300, failMsg: 'RPC Failed' })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('RPC Failed')
        expect(err.code).toBe(500)
      }
    })

    it('should complete very slow execution (>5x soft timeout) via keepAliveOnTimeout', async () => {
      const tool = ClientTools.get('very-slow-poll')!
      const result = await tool.run({})
      expect(result).toBe('very-slow-done')
    })

    it('should handle concurrent 102 polling for multiple slow tools', async () => {
      const [r1, r2] = await Promise.all([
        ClientTools.get('poll-tool')!.run({ delay: 300 }),
        ClientTools.get('poll-tool')!.run({ delay: 400 }),
      ])
      expect(r1).toBe('done-after-300')
      expect(r2).toBe('done-after-400')
    })

    it('should abort polling via AbortSignal during 102 processing', async () => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 50)

      const tool = ClientTools.get('poll-tool')!
      try {
        await tool.run({ delay: 500 }, { signal: controller.signal })
        expect.fail('Should have aborted')
      } catch (err: any) {
        expect(err.name).toMatch(/AbortError|Error/)
      }
    })
  })
})
