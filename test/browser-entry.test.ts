// @vitest-environment node
// Verify that the browser entry (src/browser.ts) exports the correct modules
// and does not import any Node.js built-in modules.

import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { ServerFuncParams } from '../src/server-tools'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Node.js built-in modules that should NOT appear in the browser bundle
// Note: We don't check 'url' because the global URL class is valid in browsers;
// only `import { URL } from 'url'` is Node-specific.
const NODE_BUILTIN_MODULES = [
  'crypto',        // Use @isdk/hash instead
  'http',          // Server-side only
  'https',         // Server-side only
  'stream',        // Server-side only (Readable, Writable, etc.)
  'fs',            // File system - server-only
  'path',          // File path - server-only
  'os',            // Operating system - server-only
  'net',           // Network - server-only
  'dns',           // DNS - server-only
  'child_process', // Process - server-only
  'cluster',       // Cluster - server-only
  'tls',           // TLS - server-only
  'zlib',          // Compression - server-only
  'assert',        // Assertion - server-only
  'querystring',   // Query string parsing
  'readline',      // Readline - server-only
  'perf_hooks',    // Performance - server-only
  'async_hooks',   // Async hooks - server-only
  'inspector',     // Inspector - server-only
  'module',        // Module system - server-only
  'v8',            // V8 engine - server-only
  'vm',            // Virtual machine - server-only
  'worker_threads',// Workers - server-only
]

// Client-side types that SHOULD appear in dist/browser.d.ts
const EXPECTED_CLIENT_TYPES = [
  'ClientTools',
  'ClientToolTransport',
  'ClientToolTransportOptions',
  'HttpClientToolTransport',
  'HttpClientToolTransportOptions',
  'RpcClientTransportManager',
  'RpcMethodsClientTool',
  'ResClientTools',
  'RPC_HEADERS',
  'RPC_DEFAULTS',
  'RpcStatusCode',
  'RpcError',
  'ToolTransport',
  'ToolTransportOptions',
  'IToolTransport',
  'ToolRpcRequest',
  'ToolRpcResponse',
  'ToolRpcContext',
  'RpcTaskRetention',
  'RpcTaskRetentionConfig',
  'RpcTaskRetentionMode',
  'RpcMethodHandler',
  'ActionNames',
  'RemoteToolFuncSchema',
  'ClientFuncItem',
  'ClientToolFuncSchema',
  'ResClientFuncParams',
  'RpcMethodsClientFuncParams',
  'RpcMethodsClientToolSchema',
  'RemoteFuncItem',
  'Funcs',
]

// Abstract server-side services and transport infrastructure (now exported from browser.ts)
const EXPECTED_SERVER_TYPES = [
  'ServerTools',
  'RpcMethodsServerTool',
  'ResServerTools',
  'RpcTransportManager',
  'RpcServerDispatcher',
  'ServerToolTransport',
  'RpcActiveTaskTracker',
  'RpcActiveTaskHandle',
  'RpcDeadlineGuard',
  'RpcTaskResource',
  'DEFAULT_COMPAT_OPTIONS',
]

// 地址工具对外只导出两类：实测有下游消费者的（grep 得到），以及第三方 transport
// 写插件时要用的契约（grep 不到，但文档承诺了）。判据见 `src/transports/README.cn.md` 的
// 「公开面判据」；名单在 transports/index.ts 与 transports/browser.ts 里是显式的。
// 下游消费者只有 tool-rpc-fastify：它用 socketAddressFromBind / socketAddressFromListen /
// normalizeListenBind / BindOptions。
const EXPORTED_ADDRESS_HELPERS = [
  'unixSocketUri',
  'unixSocketPath',
  'normalizeListenBind',
  'normalizeSocketAddress',
  'normalizeHostAndPort',
  'socketAddressFromBind',
  'socketAddressFromListen',
]
const INTERNAL_ADDRESS_HELPERS = [
  'normalizeNativeAddress',
  // 这三个只是 normalizeSocketAddress / socketAddressFromBind 的内部通道，
  // 插件覆写 getListenAddr() 返回一个字符串就够了，用不到它们。
  'hasUriScheme',
  'nativeAddressFromBind',
  'withBindOptions',
]

// Types that should NOT appear in dist/browser.d.ts (Node.js-only modules)
const FORBIDDEN_SERVER_TYPES = [
  'HttpServerToolTransport',
  'HttpServerToolTransportOptions',
  'MailboxServerTransport',
  'MailboxServerTransportOptions',
  'MailboxClientTransport',
]

describe('Browser Entry (@isdk/tool-rpc/browser)', () => {
  // ==========================================================
  // Smoke tests: verify all expected exports are present
  // ==========================================================

  it('should export all client-side modules', async () => {
    const browser = await import('../src/browser')

    // Constants
    expect(browser.ActionNames).toBeDefined()
    expect((browser as any).ActionName).toBeUndefined() // type-only, not a value
    expect(browser.RemoteToolFuncSchema).toBeDefined()

    // Client tools
    expect(browser.ClientTools).toBeDefined()
    expect(browser.RpcMethodsClientTool).toBeDefined()
    expect(browser.ResClientTools).toBeDefined()

    // Transport models & base
    expect(browser.RPC_HEADERS).toBeDefined()
    expect(browser.RPC_DEFAULTS).toBeDefined()
    expect(browser.RpcStatusCode).toBeDefined()
    expect(browser.ToolTransport).toBeDefined()
    expect(browser.RpcError).toBeDefined()

    // Client transport
    expect(browser.ClientToolTransport).toBeDefined()
    expect(browser.HttpClientToolTransport).toBeDefined()
    expect(browser.RpcClientTransportManager).toBeDefined()

    // Compat
    expect(browser.DEFAULT_COMPAT_OPTIONS).toBeDefined()
  })

  it('should export all abstract server-side services', async () => {
    const browser = await import('../src/browser')

    // Abstract service classes
    expect(browser.ServerTools).toBeDefined()
    expect(browser.RpcMethodsServerTool).toBeDefined()
    expect(browser.ResServerTools).toBeDefined()
  })

  it('should export all browser-compatible transport infrastructure', async () => {
    const browser = await import('../src/browser')

    // Server transport base
    expect(browser.ServerToolTransport).toBeDefined()
    expect((browser as any).IServerToolTransport).toBeUndefined() // interface, not a value

    // Dispatcher
    expect(browser.RpcServerDispatcher).toBeDefined()

    // Server manager
    expect(browser.RpcTransportManager).toBeDefined()

    // Task tracker
    expect(browser.RpcActiveTaskTracker).toBeDefined()
    expect(browser.RpcActiveTaskHandle).toBeDefined()

    // Deadline guard
    expect(browser.RpcDeadlineGuard).toBeDefined()

    // RPC task resource
    expect(browser.RpcTaskResource).toBeDefined()
  })

  it('should NOT export Node.js-only server modules', async () => {
    const browser = await import('../src/browser')

    expect((browser as any).HttpServerToolTransport).toBeUndefined()
    expect((browser as any).MailboxServerTransport).toBeUndefined()
    expect((browser as any).MailboxClientTransport).toBeUndefined()
  })

  it('should export only the address helpers a transport needs', async () => {
    const browser = await import('../src/browser')
    const node = await import('../src/index')

    for (const name of EXPORTED_ADDRESS_HELPERS) {
      expect(typeof (browser as any)[name], `browser entry should export '${name}'`).toBe('function')
      expect(typeof (node as any)[name], `node entry should export '${name}'`).toBe('function')
    }

    // 地址语义归各 transport 自己：normalizeNativeAddress（scheme 无关的拼写归一）
    // 只是 normalizeSocketAddress 对非 http scheme 的兜底；bind 改写与 scheme 判断则是
    // socketAddressFromBind 的内部步骤。（Host 头加固已经公开为 normalizeHostAndPort。）
    for (const name of INTERNAL_ADDRESS_HELPERS) {
      expect((browser as any)[name], `browser entry should not export '${name}'`).toBeUndefined()
      expect((node as any)[name], `node entry should not export '${name}'`).toBeUndefined()
    }

    // 两个入口的地址工具得是同一份：自定义 transport 在浏览器侧也要能算出同一个审计 key
    expect(browser.normalizeSocketAddress, 'entries should share normalizeSocketAddress')
      .toBe(node.normalizeSocketAddress)
  })

  // ==========================================================
  // Abstract service class smoke tests
  // ==========================================================

  it('ServerTools should be usable', async () => {
    const { ServerTools } = await import('../src/browser')

    ServerTools.register({
      name: 'greet',
      func: ({ name }: ServerFuncParams) => `Hi, ${name}!`,
    })

    const instance = ServerTools.get('greet')
    expect(instance).toBeDefined()
    expect(instance!.name).toBe('greet')
    expect(await instance!.run({ name: 'Browser' })).toBe('Hi, Browser!')

    ServerTools.unregister('greet')
  })

  it('RpcMethodsServerTool should be constructable', async () => {
    const { RpcMethodsServerTool } = await import('../src/browser')

    // Create a subclass to test $method auto-detection
    class CalcTool extends RpcMethodsServerTool {
      $multiply(params: any) {
        return params.a * params.b
      }
    }

    const tool = new CalcTool('calc')

    // Should auto-detect $methods
    expect(tool.methods).toContain('$multiply')
    // Direct access via alias (stripped $)
    expect(typeof (tool as any).multiply).toBe('function')
    // Call the method directly
    expect((tool as any).multiply({ a: 3, b: 4 })).toBe(12)
  })

  it('ResServerTools should be constructable', async () => {
    const { ResServerTools } = await import('../src/browser')

    // Create a subclass to properly define ResServerTools methods
    class ItemsTool extends ResServerTools {
      get({ id }: any) {
        return { id, name: `Item ${id}` }
      }
      list() {
        return [{ id: 1, name: 'Item 1' }]
      }
    }

    const tool = new ItemsTool('items')

    expect(tool.name).toBe('items')
    // Should have special RPC method names from ActionNames
    expect(tool.SpecialRpcMethodNames).toEqual(expect.arrayContaining(['get', 'post', 'put', 'delete', 'list']))
    // Instance methods should be detected
    expect(tool.methods).toContain('get')
    expect(tool.methods).toContain('list')
  })

  it('RpcTaskResource should be constructable', async () => {
    const { RpcTaskResource } = await import('../src/browser')
    const taskRes = new RpcTaskResource()
    expect(taskRes.name).toBe('rpcTask')
    expect(taskRes.methods).toContain('get')
    expect(taskRes.methods).toContain('$cancel')
  })

  // ==========================================================
  // RpcServerDispatcher — full in-memory RPC cycle
  // ==========================================================

  describe('RpcServerDispatcher in-memory cycle', () => {
    beforeEach(async () => {
      // Clean the global ToolFunc registry between tests
      const { ToolFunc } = await import('@isdk/tool-func')
      ToolFunc.items = {}
    })

    it('should dispatch a request and return a response', async () => {
      const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

      // Register a tool
      ServerTools.register({
        name: 'echo',
        func: (params: any) => {
          return { echoed: params }
        }
      })

      const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

      const response = await dispatcher.dispatch({
        apiUrl: 'memory://local',
        toolId: 'echo',
        requestId: 'req-001',
        params: { message: 'Hello, RPC!' },
        headers: {}
      })

      expect(response.status).toBe(200)
      // Compat layer injects _signal into params, so use toMatchObject
      expect(response.data).toMatchObject({ echoed: { message: 'Hello, RPC!' } })
    })

    it('should return 404 for unknown tools', async () => {
      const { RpcServerDispatcher } = await import('../src/browser')

      const dispatcher = new RpcServerDispatcher()
      // Clear registry — no tools registered
      dispatcher.registry = {}

      const response = await dispatcher.dispatch({
        apiUrl: 'memory://local',
        toolId: 'nonexistent',
        requestId: 'req-002',
        params: {},
        headers: {}
      })

      expect(response.status).toBe(404)
      expect(response.error?.message).toContain('nonexistent')
    })

    it('should handle tool with act-based routing', async () => {
      const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

      // Register a ServerTools (non-RpcMethods) — acts as passthrough
      ServerTools.register({
        name: 'router',
        func: (params: any) => {
          return { receivedAct: params.act, data: params.payload }
        }
      })

      const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

      // Dispatch with an act via header
      const response = await dispatcher.dispatch({
        apiUrl: 'memory://local',
        toolId: 'router',
        requestId: 'req-003',
        params: { payload: 'test-data' },
        headers: { 'rpc-act': 'customAction' }
      })

      expect(response.status).toBe(200)
      // act gets bridged into params via compat layer
      expect(response.data.receivedAct).toBe('customAction')
      expect(response.data.data).toBe('test-data')
    })

    it('should support resId-based routing with ResServerTools', async () => {
      const { ResServerTools, RpcServerDispatcher } = await import('../src/browser')

      // Create a subclass to properly define methods
      class ItemsTool extends ResServerTools {
        get({ id }: any) {
          return { id, name: `Item ${id}` }
        }
      }
      ItemsTool.register({
        name: 'res-items',
      })

      const dispatcher = new RpcServerDispatcher({ registry: ItemsTool })

      const response = await dispatcher.dispatch({
        apiUrl: 'memory://local',
        toolId: 'res-items',
        requestId: 'req-004',
        params: {},
        headers: { 'rpc-act': 'get', 'rpc-res-id': '42' }
      })

      expect(response.status).toBe(200)
      expect(response.data).toMatchObject({ id: '42', name: 'Item 42' })
    })

    it('should handle errors gracefully', async () => {
      const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

      ServerTools.register({
        name: 'thrower',
        func: () => {
          throw new Error('Something went wrong')
        }
      })

      const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

      const response = await dispatcher.dispatch({
        apiUrl: 'memory://local',
        toolId: 'thrower',
        requestId: 'req-005',
        params: {},
        headers: {}
      })

      expect(response.status).toBe(500)
      expect(response.error?.message).toContain('Something went wrong')
    })

    it('should support streaming tools', async () => {
      const { ServerTools, RpcServerDispatcher } = await import('../src/browser')

      ServerTools.register({
        name: 'streamer',
        stream: true,
        func: async function* () {
          yield 'chunk1'
          yield 'chunk2'
        }
      })

      const dispatcher = new RpcServerDispatcher({ registry: ServerTools })

      const response = await dispatcher.dispatch({
        apiUrl: 'memory://local',
        toolId: 'streamer',
        requestId: 'req-006',
        params: {},
        headers: {}
      })

      expect(response.status).toBe(200)
      // The stream result should be an async iterable/ReadableStream
      expect(response.data).toBeDefined()
    })
  })

  // ==========================================================
  // Transport infrastructure tests
  // ==========================================================

  describe('Transport infrastructure', () => {
    it('RpcTransportManager should manage transports (client side)', async () => {
      const { RpcTransportManager, HttpClientToolTransport } = await import('../src/browser')

      RpcTransportManager.bindScheme('http', HttpClientToolTransport)
      const transport = RpcTransportManager.instance.getClient('http://test-manager/api')
      expect(transport).toBeInstanceOf(HttpClientToolTransport)

      RpcTransportManager.clearSchemes('http')
    })

    it('RpcTransportManager should have validateRpcRequest hook (SSRF protection)', async () => {
      const { RpcTransportManager } = await import('../src/browser')

      // By default, validateRpcRequest should be a no-op
      const manager = RpcTransportManager.instance

      // Should not throw by default
      expect(() => manager.validateRpcRequest({
        apiUrl: 'http://internal-service/admin',
        toolId: 'test',
        requestId: 'req-validate',
        params: {},
        headers: {}
      })).not.toThrow()

      // After adding restricted patterns, should throw
      manager.addRestrictedPattern('internal-service')
      expect(() => manager.validateRpcRequest({
        apiUrl: 'http://internal-service/admin',
        toolId: 'test',
        requestId: 'req-restricted',
        params: {},
        headers: {}
      })).toThrow('restricted')
    })

    it('RpcActiveTaskTracker should track and manage tasks', async () => {
      const { RpcActiveTaskTracker, RpcActiveTaskHandle, RpcTaskRetentionMode } = await import('../src/browser')

      const tracker = new RpcActiveTaskTracker(10000) // 10s TTL

      const promise = Promise.resolve('done')
      const aborter = new AbortController()
      const handle = new RpcActiveTaskHandle(
        'task-001',
        promise,
        aborter,
        false, // not a stream
        () => {}, // cleanup
        RpcTaskRetentionMode.None // immediate cleanup
      )

      tracker.add('task-001', handle)

      // Should be findable
      expect(tracker.get('task-001')).toBe(handle)

      // Wait for promise to resolve
      await promise

      // Since retention is None, shouldCleanup should return true after completion
      expect(handle.shouldCleanup(Date.now())).toBe(true)

      tracker.stop()
    })

    it('RpcDeadlineGuard should enforce deadlines', async () => {
      const { RpcDeadlineGuard } = await import('../src/browser')

      // Test soft deadline (102)
      let softTriggered = false
      const guard = new RpcDeadlineGuard(
        50, // 50ms soft timeout
        {
          onResponseTimeout: () => { softTriggered = true },
          onHardDeadline: () => {}
        },
        200 // 200ms hard timeout
      )

      const deadlinePromise = guard.start()
      // Catch the expected rejection from soft timeout to prevent unhandled rejection
      deadlinePromise.catch(() => {})

      // Wait for soft timeout
      await new Promise(resolve => setTimeout(resolve, 100))

      // Soft deadline should have triggered
      expect(softTriggered).toBe(true)

      guard.cancel()
    })
  })

  // ==========================================================
  // HttpClientToolTransport smoke test
  // ==========================================================

  it('HttpClientToolTransport should be importable and constructable', async () => {
    const { HttpClientToolTransport } = await import('../src/browser')
    const transport = new HttpClientToolTransport('http://localhost:3000/api')
    expect(transport.apiUrl).toBe('http://localhost:3000/api')
    expect(transport).toBeInstanceOf(HttpClientToolTransport)
  })

  // ==========================================================
  // Client Manager tests
  // ==========================================================

  it('RpcClientTransportManager should manage client transports', async () => {
    const { RpcClientTransportManager, HttpClientToolTransport } = await import('../src/browser')

    // Register scheme
    RpcClientTransportManager.bindScheme('http', HttpClientToolTransport)

    // Get client via scheme
    const client = RpcClientTransportManager.instance.getClient('http://test/api')
    expect(client).toBeInstanceOf(HttpClientToolTransport)

    // Clean up
    RpcClientTransportManager.clearSchemes()
  })

  it('should maintain isolated singletons between client and server managers', async () => {
    const { RpcClientTransportManager, RpcTransportManager, HttpClientToolTransport } = await import('../src/browser')

    // 1. Each manager's .instance should return the same instance consistently
    const clientInstance1 = RpcClientTransportManager.instance
    const clientInstance2 = RpcClientTransportManager.instance
    expect(clientInstance1).toBe(clientInstance2)

    const serverInstance1 = RpcTransportManager.instance
    const serverInstance2 = RpcTransportManager.instance
    expect(serverInstance1).toBe(serverInstance2)

    // 2. Client and server singletons should be DIFFERENT instances
    expect(clientInstance1).not.toBe(serverInstance1)

    // 3. Static scheme registry is SHARED (via inheritance), but transport cache is per-instance
    RpcClientTransportManager.bindScheme('http', HttpClientToolTransport)

    const apiUrl = 'http://isolated-test/api'

    // Get transport from client singleton → creates and caches it in client's own transports Map
    const clientTransport = RpcClientTransportManager.instance.getClient(apiUrl)
    expect(clientTransport).toBeInstanceOf(HttpClientToolTransport)
    expect(clientTransport.apiUrl).toBe(apiUrl)

    // Get transport from server singleton → same URL, but cache is separate.
    // Because scheme is shared (static), it can resolve 'http'.
    // But because transports cache is per-instance, it creates a NEW transport.
    const serverTransport = RpcTransportManager.instance.getClient(apiUrl)
    expect(serverTransport).toBeInstanceOf(HttpClientToolTransport)

    // Same URL, different singleton → DIFFERENT transport instances (isolated caches)
    expect(serverTransport).not.toBe(clientTransport)

    // Verify: requesting same URL from same singleton returns the CACHED instance
    const clientTransportAgain = RpcClientTransportManager.instance.getClient(apiUrl)
    expect(clientTransportAgain).toBe(clientTransport)

    const serverTransportAgain = RpcTransportManager.instance.getClient(apiUrl)
    expect(serverTransportAgain).toBe(serverTransport)

    // 4. Clean up shared schemes (static, affects both)
    RpcClientTransportManager.clearSchemes()
  })

  // ==========================================================
  // Dist file verification (requires build)
  // ==========================================================

  it('should not contain Node built-in module references in dist (if built)', () => {
    const distBrowserPath = resolve(__dirname, '../dist/browser.js')
    const distBrowserMjsPath = resolve(__dirname, '../dist/browser.mjs')

    const filesToCheck = [
      { path: distBrowserPath, label: 'dist/browser.js' },
      { path: distBrowserMjsPath, label: 'dist/browser.mjs' },
    ]

    for (const { path, label } of filesToCheck) {
      if (!existsSync(path)) {
        console.warn(`Skipping: ${label} not found. Run 'pnpm build' first.`)
        continue
      }

      const content = readFileSync(path, 'utf-8')

      // Check for require() calls to Node built-in modules
      for (const mod of NODE_BUILTIN_MODULES) {
        const cjsPattern = new RegExp(`require\\(['"\`]${mod}['"\`]\\)`)
        const esmPattern = new RegExp(`from ['"\`]${mod}['"\`]`)
        const dynamicPattern = new RegExp(`import\\(['"\`]${mod}['"\`]\\)`)

        const matches = content.match(cjsPattern) || content.match(esmPattern) || content.match(dynamicPattern)
        expect(matches, `${label} should not reference Node built-in module '${mod}'`).toBeNull()
      }
    }
  })

  it('should have correct type declarations in dist/browser.d.ts (if built)', () => {
    const dtsPath = resolve(__dirname, '../dist/browser.d.ts')
    if (!existsSync(dtsPath)) {
      console.warn('Skipping: dist/browser.d.ts not found. Run \'pnpm build\' first.')
      return
    }

    const content = readFileSync(dtsPath, 'utf-8')

    // Check that all expected client-side types are present in the export list
    const finalExportMatch = content.match(/export\s+\{[^}]+\}/)
    expect(finalExportMatch, 'dist/browser.d.ts should have a final export statement').not.toBeNull()
    const exportBlock = finalExportMatch![0]

    for (const typeName of EXPECTED_CLIENT_TYPES) {
      const typePattern = new RegExp(`\\b${typeName}\\b`)
      const typeInExport = typePattern.test(exportBlock) || typePattern.test(content)
      expect(typeInExport, `dist/browser.d.ts should export '${typeName}'`).toBe(true)
    }

    // Check that abstract server-side types are also exported
    for (const typeName of EXPECTED_SERVER_TYPES) {
      const typePattern = new RegExp(`\\b${typeName}\\b`)
      const typeInExport = typePattern.test(exportBlock) || typePattern.test(content)
      expect(typeInExport, `dist/browser.d.ts should export '${typeName}'`).toBe(true)
    }

    // Check that forbidden server-only type names do NOT appear
    for (const typeName of FORBIDDEN_SERVER_TYPES) {
      const declarationPattern = new RegExp(`(declare\\s+(class|namespace|interface|type)|export\\s+.*)\\b${typeName}\\b`)
      const hasDeclaration = declarationPattern.test(content)
      expect(hasDeclaration, `dist/browser.d.ts should not contain server-only type '${typeName}'`).toBe(false)
    }
  })

  it('should pin the address helpers in dist/browser.d.ts (if built)', () => {
    const dtsPath = resolve(__dirname, '../dist/browser.d.ts')
    if (!existsSync(dtsPath)) {
      console.warn("Skipping: dist/browser.d.ts not found. Run 'pnpm build' first.")
      return
    }

    const content = readFileSync(dtsPath, 'utf-8')
    const exportBlocks = content.match(/export\s*\{[^}]*\}/g)?.join('\n') ?? ''

    for (const name of EXPORTED_ADDRESS_HELPERS) {
      expect(new RegExp(`\\b${name}\\b`).test(exportBlocks), `dist/browser.d.ts should export '${name}'`).toBe(true)
    }
    for (const name of INTERNAL_ADDRESS_HELPERS) {
      expect(new RegExp(`\\b${name}\\b`).test(exportBlocks), `dist/browser.d.ts should not export '${name}'`).toBe(false)
    }
  })
})
