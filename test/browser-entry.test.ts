// @vitest-environment node
// Verify that the browser entry (src/browser.ts) exports the correct modules
// and does not import any Node.js built-in modules.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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

// Server-only types that should NOT appear in dist/browser.d.ts
const FORBIDDEN_SERVER_TYPES = [
  'ServerTools',
  'ResServerTools',
  'RpcMethodsServerTool',
  'RpcTransportManager',
  'RpcServerTransportManager',
  'RpcServerDispatcher',
  'HttpServerToolTransport',
  'HttpServerToolTransportOptions',
  'ServerToolTransport',
  'ServerToolTransportOptions',
  'IServerToolTransport',
  'RpcActiveTaskTracker',
  'RpcActiveTaskHandle',
  'RpcDeadlineGuard',
  'RpcTaskResource',
  'MailboxServerTransport',
  'MailboxServerTransportOptions',
  'MailboxClientTransport',
]

describe('Browser Entry (@isdk/tool-rpc/browser)', () => {
  // Smoke test: Verify all expected exports from the browser entry
  it('should export all expected modules', async () => {
    const browser = await import('../src/browser')

    // Constants
    expect(browser.ActionNames).toBeDefined()
    expect(browser.ActionName).toBeUndefined() // type-only, not a value
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

    // Ensure server-only classes are NOT exported
    expect((browser as any).ServerTools).toBeUndefined()
    expect((browser as any).RpcTransportManager).toBeUndefined()
    expect((browser as any).RpcServerDispatcher).toBeUndefined()
    expect((browser as any).HttpServerToolTransport).toBeUndefined()
    expect((browser as any).ServerToolTransport).toBeUndefined()
    expect((browser as any).RpcActiveTaskTracker).toBeUndefined()
    expect((browser as any).MailboxServerTransport).toBeUndefined()
  })

  // Verify the built dist/browser.js (if the project has been built)
  // doesn't contain references to Node.js built-in modules
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
        // CJS pattern: require('http'), require("http"), require(`http`)
        const cjsPattern = new RegExp(`require\\(['"\`]${mod}['"\`]\\)`)
        // ESM pattern: from "http", from 'http', from `http`
        const esmPattern = new RegExp(`from ['"\`]${mod}['"\`]`)
        // Dynamic import pattern: import('http')
        const dynamicPattern = new RegExp(`import\\(['"\`]${mod}['"\`]\\)`)

        const matches = content.match(cjsPattern) || content.match(esmPattern) || content.match(dynamicPattern)
        expect(matches, `${label} should not reference Node built-in module '${mod}'`).toBeNull()
      }
    }
  })

  // Verify the generated dist/browser.d.ts has correct type declarations (if built)
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
      // Types may be exported with different patterns: "Foo", "type Foo", or aliased
      const typePattern = new RegExp(`\\b${typeName}\\b`)
      const typeInExport = typePattern.test(exportBlock) || typePattern.test(content)
      expect(typeInExport, `dist/browser.d.ts should export '${typeName}'`).toBe(true)
    }

    // Check that forbidden server-only type names do NOT appear
    for (const typeName of FORBIDDEN_SERVER_TYPES) {
      const forbiddenPattern = new RegExp(`\\b${typeName}\\b`)
      // Also check for 'declare class' or 'declare namespace' patterns
      const declarationPattern = new RegExp(`(declare\\s+(class|namespace|interface|type)|export\\s+.*)\\b${typeName}\\b`)
      const hasDeclaration = declarationPattern.test(content)
      expect(hasDeclaration, `dist/browser.d.ts should not contain server-only type '${typeName}'`).toBe(false)
    }
  })

  // Verify that HttpClientToolTransport is browser-compatible
  // (uses fetch, AbortController, TransformStream — all Web APIs)
  it('HttpClientToolTransport should be importable and constructable', async () => {
    const { HttpClientToolTransport } = await import('../src/browser')
    const transport = new HttpClientToolTransport('http://localhost:3000/api')
    expect(transport.apiUrl).toBe('http://localhost:3000/api')
    expect(transport).toBeInstanceOf(HttpClientToolTransport)
  })

  // Verify RpcClientTransportManager works
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

  // Verify singleton isolation between RpcClientTransportManager and RpcTransportManager
  it('should maintain isolated singletons between client and server managers', async () => {
    const { RpcClientTransportManager, HttpClientToolTransport } = await import('../src/browser')
    const { RpcTransportManager } = await import('../src/transports/server-manager')

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
    // Register scheme on client manager → available to all managers via static inheritance
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
})
