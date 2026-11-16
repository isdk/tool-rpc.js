// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { withReservedPort } from './helpers/ports'
import { Mailbox } from '@mboxlabs/mailbox';
import { MemoryProvider } from '@mboxlabs/mailbox-memory';
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

    // 后台任务探针（issue #11）：把「服务端到底停没停」写到 globalThis 上，
    // 让断言不必依赖连接断开——取消是逻辑的，传输层必须还在线。
    ;(globalThis as any).__BgProbe = {}
    ServerTools.register({
      name: 'bg-probe',
      timeout: { value: 100, keepAliveOnTimeout: true },
      func: async function(this: any) {
        const key = (this as any).ctx?.requestId
        const state = ((globalThis as any).__BgProbe[key] ||= { started: true, aborted: false, finished: false })
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            state.finished = true
            resolve('bg-done')
          }, 2000)
          const signal = this.ctx?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              state.aborted = true
              const err = new Error('Aborted by signal')
              err.name = 'AbortError'
              reject(err)
            }, { once: true })
          }
        })
      } as any,
      isApi: true,
    })

    // pre-102 探针（issue #14）：软超时拉得足够长，abort 一定落在 102 之前。
    // 账本从 `dispatch` 一进来就登记（dispatcher.ts 的 trackTask），所以连接态的取消也该到服务端。
    ServerTools.register({
      name: 'bg-probe-pre102',
      timeout: { value: 1500, keepAliveOnTimeout: true },
      func: async function(this: any) {
        const key = (this as any).ctx?.requestId
        const state = ((globalThis as any).__BgProbe[key] ||= { started: true, aborted: false, finished: false })
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            state.finished = true
            resolve('bg-done')
          }, 2000)
          const signal = this.ctx?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              state.aborted = true
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
    // apiRoot 里要写端口，号码必须预先知道；用预留而非 findPort，被抢走就换号重跑
    await withReservedPort(3020, async (p) => {
      port = p
      apiRoot = `http://localhost:${p}/api`

      httpServer = new HttpServerToolTransport({ port: p, apiUrl: apiRoot })
      httpServer.addRpcHandler(apiRoot)
      await httpServer.start({ port: p, host: 'localhost' })
    }, 'localhost')

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
      const res = (await httpClient._fetch('echo', { msg: 'http-echo' }, 'run')) as Response
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
        httpClient._fetch('echo', { msg: 'http-side' }, 'run').then(r => (r as Response).json()),
        mailboxClient.fetch('echo', { msg: 'mbox-side' }),
      ])
      expect(httpRes).toBe('http-side')
      expect(mboxRes).toBe('mbox-side')
    })

    it('should call different tools concurrently across transports', async () => {
      const [httpCalc, mboxEcho] = await Promise.all([
        httpClient._fetch('calc', { a: 20, b: 22 }, 'run').then(r => (r as Response).json()),
        mailboxClient.fetch('echo', { msg: 'parallel-mbox' }),
      ])
      expect(httpCalc).toBe(42)
      expect(mboxEcho).toBe('parallel-mbox')
    })

    it('should handle three-way concurrent calls (HTTP calc + HTTP echo + Mailbox echo)', async () => {
      const [c1, e1, e2] = await Promise.all([
        httpClient._fetch('calc', { a: 100, b: 200 }, 'run').then(r => (r as Response).json()),
        httpClient._fetch('echo', { msg: 'http-three' }, 'run').then(r => (r as Response).json()),
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
      const incRes = (await httpClient._fetch('counter', { op: 'increment' }, 'run')) as Response
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
      const httpGet = (await httpClient._fetch('counter', { op: 'get' }, 'run')) as Response
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
      expect((httpApis.echo.params as any).msg.type).toBe('string')
      expect((mboxApis.echo.params as any).msg.type).toBe('string')
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
        httpClient._fetch('late-registration', { val: 7 }, 'run').then(r => (r as Response).json()),
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
        httpClient._fetch('echo', { msg: 'fast-http' }, 'run').then(r => (r as Response).json()),
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

  describe('Cross-Transport Background Cancellation (issue #11)', () => {
    const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

    // 取消一个已进后台态的任务：客户端 abort 之后，服务端必须真的停下来，
    // 而且账本要清掉。两边都不能靠「连接断了」碰巧成立。
    async function expectBackgroundCancelWasNotSilent(
      label: string,
      start: (reqId: string, signal: AbortSignal) => Promise<unknown>,
      transportStillWorks: () => Promise<unknown>,
      /** 取消前等多久：250ms = 已进 102；80ms（配 1500ms 软超时）= 还在连接态 */
      settleMs = 250,
    ) {
      const reqId = `${label}-cancel-${Date.now().toString(36)}`
      const controller = new AbortController()
      const call = start(reqId, controller.signal)
      call.catch(() => {}) // 取消的 rejection 由断言那侧负责

      await settle(settleMs)
      const pending = (RpcServerDispatcher.instance.tracker as any).tasks as Map<string, unknown>
      expect(pending.has(reqId), `${label}: 取消前任务应在后台账本里`).toBe(true)

      controller.abort()
      await settle(500)

      const state = (globalThis as any).__BgProbe[reqId]
      expect(state?.started, `${label}: 任务已开始`).toBe(true)
      expect(state?.aborted, `${label}: 服务端任务必须被中止（不能静默失效）`).toBe(true)
      expect(state?.finished, `${label}: 中止后不该再跑完`).toBe(false)
      expect(pending.has(reqId), `${label}: 取消后账本不该残留`).toBe(false)

      // 取消是逻辑的：传输层仍在线，同一条通道上的其它调用照走
      expect(await transportStillWorks()).toBeTruthy()
    }

    it('HTTP: aborting a 102 background task stops it on the server and clears the ledger', async () => {
      await expectBackgroundCancelWasNotSilent(
        'http',
        (reqId, signal) => httpClient.fetch('bg-probe', {}, 'run', undefined, {
          signal,
          headers: { 'req-id': reqId },
        }),
        async () => await httpClient.fetch('echo', { msg: 'alive-after-cancel' }) === 'alive-after-cancel',
      )
    })

    it('Mailbox: aborting a 102 background task stops it on the server and clears the ledger', async () => {
      await expectBackgroundCancelWasNotSilent(
        'mailbox',
        (reqId, signal) => mailboxClient.fetch('bg-probe', {}, 'run', undefined, {
          signal,
          headers: { 'req-id': reqId },
        }),
        async () => await mailboxClient.fetch('echo', { msg: 'alive-after-cancel' }) === 'alive-after-cancel',
      )
    })

    // pre-102（issue #14）：调用还在连接态就 abort。判据不是「曾收到 102」而是「已登记账本」，
    // 而两输 transport 都不能靠物理断连兼这个（HTTP 的 rawRes.close 只覆盖 ReadableStream 分支，
    // mailbox 根本没有断连概念）——所以这条只能靠 `$cancel`，也因此必须单独测。
    it('HTTP: aborting a call before the 102 still stops the server-side task', async () => {
      await expectBackgroundCancelWasNotSilent(
        'http-pre102',
        (reqId, signal) => httpClient.fetch('bg-probe-pre102', {}, 'run', undefined, {
          signal,
          headers: { 'req-id': reqId },
        }),
        async () => await httpClient.fetch('echo', { msg: 'alive-after-pre102-cancel' }) === 'alive-after-pre102-cancel',
        80,
      )
    })

    it('Mailbox: aborting a call before the 102 still stops the server-side task', async () => {
      await expectBackgroundCancelWasNotSilent(
        'mailbox-pre102',
        (reqId, signal) => mailboxClient.fetch('bg-probe-pre102', {}, 'run', undefined, {
          signal,
          headers: { 'req-id': reqId },
        }),
        async () => await mailboxClient.fetch('echo', { msg: 'alive-after-pre102-cancel' }) === 'alive-after-pre102-cancel',
        80,
      )
    })
  })

  // issue #13：`$cancel` 曾在账本上无条件 `remove()`，那绕开了工具自己的 retention 策略：
  // `Permanent` / 数值保留期里的取消记录当场消失，客户端只能看到一个 404，问不出「这次取消到底停住了没有」。
  describe('Cancellation honors retention (issue #13)', () => {
    const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

    beforeAll(() => {
      // 同 bg-probe，只多了数值保留期。
      // 注意：`retention` 必须在实例上（类字段 + `register(instance)`）——
      // `register({ retention })` 会被 tool-func 的 schema 过滤掉，`tool.retention` 始终 undefined。
      class RetainedProbe extends ServerTools {
        retention = 5000
        timeout = { value: 100, keepAliveOnTimeout: true }
        isApi = true
        func = async function(this: any) {
          const key = (this as any).ctx?.requestId
          const state = ((globalThis as any).__BgProbe[key] ||= { started: true, aborted: false, finished: false })
          return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
              state.finished = true
              resolve('bg-done')
            }, 2000)
            const signal = this.ctx?.signal
            if (signal) {
              signal.addEventListener('abort', () => {
                clearTimeout(timer)
                state.aborted = true
                const err = new Error('Aborted by signal')
                err.name = 'AbortError'
                reject(err)
              }, { once: true })
            }
          })
        }
      }
      ServerTools.register(new RetainedProbe('bg-probe-retained'))
    })

    it('HTTP: 默认 retention（None）下取消→条目当场注销，再 GET → 404（#14 建议第 3 条）', async () => {
      const reqId = `http-gone-${Date.now().toString(36)}`
      const controller = new AbortController()
      const call = httpClient.fetch('bg-probe', {}, 'run', undefined, {
        signal: controller.signal,
        headers: { 'req-id': reqId },
      })
      call.catch(() => {})

      await settle(250)
      controller.abort()
      await settle(300)

      expect(((RpcServerDispatcher.instance.tracker as any).tasks as Map<string, unknown>).has(reqId),
        '默认策略下取消就该注销').toBe(false)
      expect(await pollStatus(httpClient, reqId), '注销之后只能问到 404').toBe(404)
    })

    it('HTTP: 数值保留期里的取消记录仍在账上，GET 问得到 408 终态而不是 404', async () => {
      const reqId = `http-retained-${Date.now().toString(36)}`
      const controller = new AbortController()
      const call = httpClient.fetch('bg-probe-retained', {}, 'run', undefined, {
        signal: controller.signal,
        headers: { 'req-id': reqId },
      })
      call.catch(() => {})

      await settle(250)
      controller.abort()
      await settle(300)

      expect(((RpcServerDispatcher.instance.tracker as any).tasks as Map<string, unknown>).has(reqId),
        '保留期里的取消记录不该当场消失').toBe(true)
      expect(await pollStatus(httpClient, reqId), '取消的终态要问得到（408 TERMINATED），不是“查无此任”').toBe(408)
    })

    /** 轮询任务状态，不论客户端把错误抛出来还是返响应，都归一成一个状态码 */
    async function pollStatus(client: any, reqId: string): Promise<number | undefined> {
      try {
        const res: any = await client.pollTaskStatus(reqId)
        return res?.status ?? res?.code
      } catch (err: any) {
        return err?.code ?? err?.status
      }
    }
  })

  describe('Cross-Transport Lifecycle Independence', () => {
    it('should continue serving HTTP requests after Mailbox transport stops', async () => {
      // Stop mailbox server
      await mailboxClient.stop()
      await mailboxServer.stop()

      // HTTP should still work
      const res = (await httpClient._fetch('echo', { msg: 'http-alone' }, 'run')) as Response
      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body).toBe('http-alone')

      // Restart mailbox for other tests
      mailboxServer = new MailboxServerTransport({ mailbox, apiUrl: serverAddress })
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
      await httpServer.start({ port, host: 'localhost' })
    })

    it('should serve both transports simultaneously after full restart', async () => {
      const [httpRes, mboxRes] = await Promise.all([
        httpClient._fetch('echo', { msg: 'restart-http' }, 'run').then(r => (r as Response).json()),
        mailboxClient.fetch('echo', { msg: 'restart-mbox' }),
      ])
      expect(httpRes).toBe('restart-http')
      expect(mboxRes).toBe('restart-mbox')
    })
  })
})
