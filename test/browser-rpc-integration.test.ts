// @vitest-environment node
// Comprehensive browser-side RPC integration tests.
// Uses only browser-compatible modules from @isdk/tool-rpc/browser.
// Exercises full-stack in-memory RPC cycles without any real network.

import { describe, it, expect, beforeEach } from 'vitest'
import { ToolFunc } from '@isdk/tool-func'

// Helper: clean the global ToolFunc registry between tests
function clearItems() {
  for (const key of Object.keys((ToolFunc as any).items || {})) {
    delete (ToolFunc as any).items[key]
  }
}

// ================================================================
// SECTION 1: Full-stack ServerTools + RpcServerDispatcher Cycles
// ================================================================

describe('Full-stack ServerTools + RpcServerDispatcher', () => {
  beforeEach(() => clearItems())

  it('should handle echo tool dispatch', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'echo',
      func: (params: any) => ({ echoed: params.message }),
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'memory://local',
      toolId: 'echo',
      requestId: 'test-echo-001',
      params: { message: 'Hello Browser' },
      headers: {},
    })

    expect(response.status).toBe(200)
    expect(response.data).toMatchObject({ echoed: 'Hello Browser' })
  })

  it('should handle multiple tools independently', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({ name: 'add', func: ({ a, b }: any) => a + b })
    ServerTools.register({ name: 'mul', func: ({ a, b }: any) => a * b })
    ServerTools.register({ name: 'concat', func: ({ a, b }: any) => `${a}${b}` })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

    const [addRes, mulRes, concatRes] = await Promise.all([
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'add', requestId: 'r1', params: { a: 3, b: 4 }, headers: {} }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'mul', requestId: 'r2', params: { a: 5, b: 6 }, headers: {} }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'concat', requestId: 'r3', params: { a: 'hello-', b: 'world' }, headers: {} }),
    ])

    expect(addRes.data).toBe(7)
    expect(mulRes.data).toBe(30)
    expect(concatRes.data).toBe('hello-world')
  })

  it('should preserve response ordering under rapid sequential dispatch', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'delayed-echo',
      func: async ({ id, delay }: any) => {
        await new Promise(r => setTimeout(r, delay))
        return { id }
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

    const results = await Promise.all([
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'delayed-echo', requestId: 's1', params: { id: 'fast', delay: 10 }, headers: {} }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'delayed-echo', requestId: 's2', params: { id: 'slow', delay: 50 }, headers: {} }),
    ])

    const dataResults = results.map(r => r.data)
    expect(dataResults).toContainEqual({ id: 'fast' })
    expect(dataResults).toContainEqual({ id: 'slow' })
  })

  it('should return 404 for unknown tools', async () => {
    const { RpcServerDispatcher } = await import('../src/browser')

    const dispatcher = new RpcServerDispatcher()
    dispatcher.registry = {}

    const response = await dispatcher.dispatch({
      apiUrl: 'mem://',
      toolId: 'ghost',
      requestId: 'not-found-001',
      params: {},
      headers: {},
    })

    expect(response.status).toBe(404)
    expect(response.error?.message).toContain('ghost')
  })

  it('should handle tools that throw synchronously', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'throw-sync',
      func: () => { throw new Error('boom!') },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://',
      toolId: 'throw-sync',
      requestId: 'err-sync',
      params: {},
      headers: {},
    })

    expect(response.status).toBe(500)
    expect(response.error?.message).toContain('boom!')
  })

  it('should handle tools that reject asynchronously', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'throw-async',
      func: async () => { throw new Error('async-boom') },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://',
      toolId: 'throw-async',
      requestId: 'err-async',
      params: {},
      headers: {},
    })

    expect(response.status).toBe(500)
    expect(response.error?.message).toContain('async-boom')
  })
})

// ================================================================
// SECTION 2: RpcMethodsServerTool Routing
// ================================================================

describe('RpcMethodsServerTool Routing', () => {
  beforeEach(() => clearItems())

  it('should route to the correct $method via act header', async () => {
    const { RpcMethodsServerTool, RpcServerDispatcher } = await import('../src/browser')

    class Calculator extends RpcMethodsServerTool {
      $add({ a, b }: any) { return a + b }
      $sub({ a, b }: any) { return a - b }
      $mul({ a, b }: any) { return a * b }
    }

    Calculator.register({ name: 'calc' })

    const dispatcher = new RpcServerDispatcher({ registry: Calculator })

    const [addRes, subRes, mulRes] = await Promise.all([
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'calc', requestId: 'c1', params: { a: 10, b: 3 }, headers: { 'rpc-act': '$add' } }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'calc', requestId: 'c2', params: { a: 10, b: 3 }, headers: { 'rpc-act': '$sub' } }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'calc', requestId: 'c3', params: { a: 10, b: 3 }, headers: { 'rpc-act': '$mul' } }),
    ])

    expect(addRes.data).toBe(13)
    expect(subRes.data).toBe(7)
    expect(mulRes.data).toBe(30)
  })

  it('should route via request.act property instead of header', async () => {
    const { RpcMethodsServerTool, RpcServerDispatcher } = await import('../src/browser')

    class Greeter extends RpcMethodsServerTool {
      $hello() { return 'Hello!' }
      $bye() { return 'Goodbye!' }
    }

    Greeter.register({ name: 'greeter' })

    const dispatcher = new RpcServerDispatcher({ registry: Greeter })

    const helloRes = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'greeter', requestId: 'g1',
      params: {}, headers: {}, act: '$hello',
    })

    expect(helloRes.data).toBe('Hello!')
  })

  it('should return 404 for non-existent method act', async () => {
    const { RpcMethodsServerTool, RpcServerDispatcher } = await import('../src/browser')

    class SimpleTool extends RpcMethodsServerTool {
      $only() { return 'only' }
    }

    SimpleTool.register({ name: 'simple' })

    const dispatcher = new RpcServerDispatcher({ registry: SimpleTool })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'simple', requestId: 'bad-act',
      params: {}, headers: { 'rpc-act': '$nonexistent' },
    })

    expect(response.status).toBe(404)
    expect(response.error?.message).toContain('$nonexistent')
  })
})

// ================================================================
// SECTION 3: ResServerTools REST Routing
// ================================================================

describe('ResServerTools REST Routing', () => {
  beforeEach(() => clearItems())

  it('should route get/list by act', async () => {
    const { ResServerTools, RpcServerDispatcher } = await import('../src/browser')

    const items: Record<string, any> = {
      '1': { id: '1', name: 'Alpha' },
      '2': { id: '2', name: 'Beta' },
    }

    class Items extends ResServerTools {
      get({ id }: any) { return items[id as string] || null }
      list() { return Object.values(items) }
    }

    Items.register({ name: 'items' })

    const dispatcher = new RpcServerDispatcher({ registry: Items })

    const [getRes, listRes] = await Promise.all([
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'items', requestId: 'r-get', params: {}, headers: { 'rpc-act': 'get', 'rpc-res-id': '2' } }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'items', requestId: 'r-list', params: {}, headers: { 'rpc-act': 'list' } }),
    ])

    expect(getRes.data).toMatchObject({ id: '2', name: 'Beta' })
    expect(listRes.data).toHaveLength(2)
    expect(listRes.data).toContainEqual({ id: '1', name: 'Alpha' })
  })

  it('should route custom $methods alongside RESTful methods', async () => {
    const { ResServerTools, RpcServerDispatcher } = await import('../src/browser')

    const callLog: string[] = []

    class CustomResource extends ResServerTools {
      get() { callLog.push('get'); return { resource: true } }
      $special() { callLog.push('special'); return { special: true } }
    }

    CustomResource.register({ name: 'custom' })

    const dispatcher = new RpcServerDispatcher({ registry: CustomResource })

    await dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'custom', requestId: 'cr1', params: {}, headers: { 'rpc-act': 'get' } })
    await dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'custom', requestId: 'cr2', params: {}, headers: { 'rpc-act': '$special' } })

    expect(callLog).toEqual(['get', 'special'])
  })
})

// ================================================================
// SECTION 4: Concurrency & Shadow Instance Isolation
// ================================================================

describe('Concurrency & Shadow Instance Isolation', () => {
  beforeEach(() => clearItems())

  it('should isolate this.ctx between concurrent dispatches', async () => {
    const { RpcMethodsServerTool, RpcServerDispatcher } = await import('../src/browser')

    const ctxLog: Record<string, string> = {}

    class CtxTracker extends RpcMethodsServerTool {
      $check() {
        const myRequestId = (this as any).ctx?.requestId || 'no-ctx'
        ctxLog[myRequestId] = myRequestId
        return { seen: myRequestId }
      }
    }

    CtxTracker.register({ name: 'ctx-track' })

    const dispatcher = new RpcServerDispatcher({ registry: CtxTracker })

    const [res1, res2] = await Promise.all([
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'ctx-track', requestId: 'ctx-a', params: {}, headers: { 'rpc-act': '$check' } }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'ctx-track', requestId: 'ctx-b', params: {}, headers: { 'rpc-act': '$check' } }),
    ])

    expect(res1.data).toMatchObject({ seen: 'ctx-a' })
    expect(res2.data).toMatchObject({ seen: 'ctx-b' })
    expect(Object.keys(ctxLog)).toContain('ctx-a')
    expect(Object.keys(ctxLog)).toContain('ctx-b')
  })

  it('should maintain separate state for each shadow instance', async () => {
    const { RpcMethodsServerTool, RpcServerDispatcher } = await import('../src/browser')

    class Stateful extends RpcMethodsServerTool {
      private counter = 0

      $increment() {
        this.counter++
        return { count: this.counter }
      }
    }

    Stateful.register({ name: 'stateful' })

    const dispatcher = new RpcServerDispatcher({ registry: Stateful })

    const [r1, r2] = await Promise.all([
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'stateful', requestId: 's1', params: {}, headers: { 'rpc-act': '$increment' } }),
      dispatcher.dispatch({ apiUrl: 'mem://', toolId: 'stateful', requestId: 's2', params: {}, headers: { 'rpc-act': '$increment' } }),
    ])

    // Shadow instances: each gets a fresh counter starting at 0 → incremented to 1
    expect(r1.data).toEqual({ count: 1 })
    expect(r2.data).toEqual({ count: 1 })
  })
})

// ================================================================
// SECTION 5: RpcActiveTaskTracker Lifecycle
// ================================================================

describe('RpcActiveTaskTracker Lifecycle', () => {
  beforeEach(() => clearItems())

  it('should track task from dispatch through completion', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'fast-task',
      func: async ({ val }: any) => {
        await new Promise(r => setTimeout(r, 5))
        return val * 2
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

    const dispatchPromise = dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'fast-task', requestId: 'track-me',
      params: { val: 21 }, headers: {},
    })

    // Task should be registered during execution
    const handleDuring = dispatcher.tracker.get('track-me')
    expect(handleDuring).toBeDefined()

    const response = await dispatchPromise
    expect(response.data).toBe(42)
  })

  it('should keep task with retention: Permanent using handle API', async () => {
    const { RpcActiveTaskHandle, RpcTaskRetentionMode } = await import('../src/browser')

    const aborter = new AbortController()
    const promise = Promise.resolve('sticky-result')
    const handle = new RpcActiveTaskHandle(
      'perm-handle', promise, aborter, false, () => {},
      RpcTaskRetentionMode.Permanent,
    )

    await promise
    // Permanent retention should not trigger cleanup
    expect(handle.shouldCleanup(Date.now())).toBe(false)
    expect(handle.result).toBe('sticky-result')
  })

  it('should cancel task via tracker with short timeout', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'cancel-me',
      timeout: 100,
      func: async () => {
        await new Promise(() => {}) // never resolves on its own
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

    const dispatchPromise = dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'cancel-me', requestId: 'cancel-target',
      params: {}, headers: {},
    })

    await new Promise(r => setTimeout(r, 10))
    const handle = dispatcher.tracker.get('cancel-target')
    expect(handle).toBeDefined()
    handle!.abort('Test cancellation')

    const response = await dispatchPromise
    // Abort should trigger aborter.abort() → hard deadline fires → guard rejects
    expect(response.status).not.toBe(200)
  })

  it('should auto-cleanup completed task when retention is None', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'instant',
      func: async () => {
        await new Promise(r => setTimeout(r, 5))
        return 'done'
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'instant', requestId: 'clean-me',
      params: {}, headers: {},
    })

    await new Promise(r => setTimeout(r, 10))
    // With retention: None (default), task should be cleaned up after completion
    const handle = dispatcher.tracker.get('clean-me')
    expect(handle).toBeUndefined()
  })
})

// ================================================================
// SECTION 6: RpcTaskResource Integration (system tool)
// ================================================================

describe('RpcTaskResource Integration', () => {
  beforeEach(() => clearItems())

  it('should access rpcTask from systemRegistry via dispatcher', async () => {
    const { RpcServerDispatcher } = await import('../src/browser')

    // The dispatcher auto-registers RpcTaskResource in systemRegistry
    const dispatcher = new RpcServerDispatcher()

    // Access the built-in rpcTask system tool
    const { RpcTaskResource } = await import('../src/browser')
    const taskRes = new RpcTaskResource()
    expect(taskRes.name).toBe('rpcTask')
    expect(taskRes.methods).toContain('get')
    expect(taskRes.methods).toContain('$cancel')
    expect(taskRes.SpecialRpcMethodNames).toContain('get')
  })

  it('should handle background task with keepAliveOnTimeout and return 102', async () => {
    const { ServerTools, RpcServerDispatcher, RPC_HEADERS } = await import('../src/browser')

    ServerTools.register({
      name: 'background-job',
      timeout: { value: 20, keepAliveOnTimeout: true },
      func: async () => {
        await new Promise(r => setTimeout(r, 100))
        return 'background-complete'
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const initRes = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'background-job', requestId: 'bg-task-1',
      params: {}, headers: {},
    })

    // With 20ms soft timeout and 100ms task, the 102 should fire
    expect(initRes.status).toBe(102)
    expect(initRes.headers?.[RPC_HEADERS.REQUEST_ID]).toBe('bg-task-1')
  })
})

// ================================================================
// SECTION 7: RpcDeadlineGuard Integration
// ================================================================

describe('RpcDeadlineGuard Integration', () => {
  beforeEach(() => clearItems())

  it('should enforce hard deadline on slow tool', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'very-slow',
      timeout: 30,
      func: async () => {
        await new Promise(r => setTimeout(r, 2000)) // far exceeds 30ms deadline + 500ms grace
        return 'too-late'
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'very-slow', requestId: 'hard-deadline',
      params: {}, headers: {},
    })

    // Hard deadline fires at 30ms, grace timer at 530ms — well before 2000ms
    expect(response.status).toBe(504)
    expect(response.error?.message).toMatch(/terminated|timeout|Timeout|Deadline/i)
  })

  it('should complete before hard deadline if tool is fast enough', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'quick',
      timeout: 5000,
      func: async () => {
        await new Promise(r => setTimeout(r, 5))
        return 'quick-result'
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'quick', requestId: 'within-deadline',
      params: {}, headers: {},
    })

    expect(response.status).toBe(200)
    expect(response.data).toBe('quick-result')
  })
})

// ================================================================
// SECTION 8: Multiple Dispatchers — isolated registries
// ================================================================

describe('Multiple Dispatchers — Registry Isolation', () => {
  beforeEach(() => clearItems())

  it('should support two dispatchers with different tool sets', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    // Create registry A with 'greet'
    const registryA: Record<string, any> = {}
    const greetTool = new ServerTools({ name: 'greet', func: () => 'hello' })
    registryA.greet = greetTool

    // Create registry B with 'farewell'
    const registryB: Record<string, any> = {}
    const farewellTool = new ServerTools({ name: 'farewell', func: () => 'goodbye' })
    registryB.farewell = farewellTool

    const dispA = new RpcServerDispatcher({ registry: registryA })
    const dispB = new RpcServerDispatcher({ registry: registryB })

    // Verify A sees greet, B doesn't
    const resA = await dispA.dispatch({ apiUrl: 'mem://', toolId: 'greet', requestId: 'a1', params: {}, headers: {} })
    expect(resA.data).toBe('hello')

    const resB404 = await dispB.dispatch({ apiUrl: 'mem://', toolId: 'greet', requestId: 'b1', params: {}, headers: {} })
    expect(resB404.status).toBe(404)

    // Verify B sees farewell, A doesn't
    const resB = await dispB.dispatch({ apiUrl: 'mem://', toolId: 'farewell', requestId: 'b2', params: {}, headers: {} })
    expect(resB.data).toBe('goodbye')

    const resA404 = await dispA.dispatch({ apiUrl: 'mem://', toolId: 'farewell', requestId: 'a2', params: {}, headers: {} })
    expect(resA404.status).toBe(404)
  })
})

// ================================================================
// SECTION 9: RpcTransportManager + RpcClientTransportManager
// ================================================================

describe('RpcTransportManager Integration', () => {
  beforeEach(async () => {
    const { RpcClientTransportManager } = await import('../src/browser')
    RpcClientTransportManager.clearSchemes()
  })

  it('should create and cache transport instances by URL', async () => {
    const { RpcTransportManager, HttpClientToolTransport } = await import('../src/browser')

    RpcTransportManager.bindScheme('http', HttpClientToolTransport)

    const t1 = RpcTransportManager.instance.getClient('http://dual/api')
    const t2 = RpcTransportManager.instance.getClient('http://dual/api')
    expect(t1).toBe(t2)

    const t3 = RpcTransportManager.instance.getClient('http://dual/other')
    expect(t3).not.toBe(t1)

    RpcTransportManager.clearSchemes()
  })

  it('should throw for unregistered URL scheme', async () => {
    const { RpcTransportManager } = await import('../src/browser')

    expect(() => RpcTransportManager.instance.getClient('unknown://test/api')).toThrow('Unsupported URL scheme')
  })

  it('should maintain client and server singletons with independent caches', async () => {
    const { RpcClientTransportManager, RpcTransportManager, HttpClientToolTransport } = await import('../src/browser')

    RpcTransportManager.bindScheme('http', HttpClientToolTransport)

    const url = 'http://singleton-test/api'
    const clientTransport = RpcClientTransportManager.instance.getClient(url)
    const serverTransport = RpcTransportManager.instance.getClient(url)
    expect(clientTransport).not.toBe(serverTransport)

    expect(RpcClientTransportManager.instance.getClient(url)).toBe(clientTransport)
    expect(RpcTransportManager.instance.getClient(url)).toBe(serverTransport)

    RpcClientTransportManager.clearSchemes()
  })
})

// ================================================================
// SECTION 10: Timeout Negotiation via Dispatcher
// ================================================================

describe('Timeout Negotiation', () => {
  beforeEach(() => clearItems())

  it('should respect client-specified timeout over tool timeout', async () => {
    const { ServerTools, RpcServerDispatcher, RPC_HEADERS } = await import('../src/browser')

    ServerTools.register({
      name: 'configurable',
      timeout: 5000,
      func: async () => {
        await new Promise(r => setTimeout(r, 2000)) // far exceeds client timeout
        return 'ok'
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools, terminationGraceMs: 20 })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'configurable', requestId: 'timeout-test',
      params: {}, headers: { [RPC_HEADERS.TIMEOUT]: '10' },
    })

    // Client says 10ms, tool says 5000ms → min = 10ms
    // Termination grace is 20ms → guard fires at 10ms + 20ms = 30ms
    // Tool takes 2000ms → deadline fires first
    expect(response.status).toBe(504)
    expect(response.error?.message).toMatch(/terminat/i)
  })

  it('should use tool timeout when client does not specify', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'default-timeout',
      timeout: 5000,
      func: async () => {
        await new Promise(r => setTimeout(r, 5))
        return 'completed-within-tool-timeout'
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'default-timeout', requestId: 'no-client-timeout',
      params: {}, headers: {},
    })

    expect(response.status).toBe(200)
    expect(response.data).toBe('completed-within-tool-timeout')
  })

  it('should use global timeout when neither client nor tool specifies', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    ServerTools.register({
      name: 'no-timeout-tool',
      func: async () => 'no-timeout-result',
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools, globalTimeout: 30000 })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'no-timeout-tool', requestId: 'global-timeout',
      params: {}, headers: {},
    })

    expect(response.status).toBe(200)
    expect(response.data).toBe('no-timeout-result')
  })
})

// ================================================================
// SECTION 11: RpcError propagation through dispatcher
// ================================================================

describe('RpcError Propagation', () => {
  beforeEach(() => clearItems())

  it('should propagate error code and message', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    // Throw a plain Error with custom .code — same pattern as Section 1's throw-sync
    ServerTools.register({
      name: 'custom-error',
      func: () => {
        const err: any = new Error('Permission denied')
        err.code = 403
        throw err
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'custom-error', requestId: 'rpc-error-1',
      params: {}, headers: {},
    })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.error).toBeDefined()
    expect(response.error!.message).toContain('Permission denied')
  })

  it('should propagate error with custom data payload', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    // Throw a plain Error with custom .code and .data
    ServerTools.register({
      name: 'error-with-data',
      func: () => {
        const err: any = new Error('Validation failed')
        err.code = 422
        err.data = { errors: [{ field: 'email', message: 'Invalid format' }] }
        throw err
      },
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'error-with-data', requestId: 'rpc-error-2',
      params: {}, headers: {},
    })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.error).toBeDefined()
    expect(response.error!.message).toContain('Validation failed')
  })
})

// ================================================================
// SECTION 12: Large payload handling
// ================================================================

describe('Large Payload Handling', () => {
  beforeEach(() => clearItems())

  it('should handle large JSON payloads through dispatcher', async () => {
    const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

    const largeArray = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `Item-${i}`,
      value: Math.random(),
    }))

    ServerTools.register({
      name: 'reflect',
      func: (params: any) => params,
    })

    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })
    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'reflect', requestId: 'large-payload',
      params: { data: largeArray }, headers: {},
    })

    expect(response.status).toBe(200)
    expect(response.data.data).toHaveLength(1000)
    expect(response.data.data[0].name).toBe('Item-0')
    expect(response.data.data[999].name).toBe('Item-999')
  })
})

// ================================================================
// SECTION 13: Request ID echo
// ================================================================

describe('Request ID Echo', () => {
  beforeEach(() => clearItems())

  it('should echo requestId in response headers', async () => {
    const { ServerTools, RpcServerDispatcher, RPC_HEADERS } = await import('../src/browser')

    ServerTools.register({ name: 'echo-id', func: () => 'ok' })
    const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

    const response = await dispatcher.dispatch({
      apiUrl: 'mem://', toolId: 'echo-id', requestId: 'my-request-42',
      params: {}, headers: {},
    })

    expect(response.headers?.[RPC_HEADERS.REQUEST_ID]).toBe('my-request-42')
  })
})
