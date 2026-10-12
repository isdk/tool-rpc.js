// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withReservedPort } from './helpers/ports'
import { ToolFunc } from '@isdk/tool-func'
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox'

import { MailboxClientTransport } from '../src/transports/mailbox-client'
import { MailboxServerTransport } from '../src/transports/mailbox-server'
import { HttpClientToolTransport } from '../src/transports/http-client'
import { HttpServerToolTransport } from '../src/transports/http-server'
import { RpcServerDispatcher } from '../src/transports/dispatcher'
import { RpcTransportManager } from '../src/transports/server-manager'
import { RpcClientTransportManager } from '../src/transports/client-manager'
import { ServerTools } from '../src/server-tools'
import { ClientTools } from '../src/client-tools'
import { RpcBearerPolicy } from '../src/transports/identity-bearer'
import { RPC_APIS_TOOL_ID, RpcError, RpcStatusCode } from '../src/transports/models'

/**
 * 发现端点的端到端验证：真 socket、真客户端，走完整流水线。
 *
 * 钉的是这次改动的核心主张——**列工具清单是一个普通 API**（内置工具 `rpcApis`），
 * 不是 transport 里的旁路分支。所以：
 * - `manager.validateRpcRequest` 拦得到它（架构层策略覆盖它，否则只能被绕过）
 * - 身份策略判定得到它（`ctx.toolId === 'rpcApis'`，与业务 API 同一套字段）
 * - `globalTimeout` 管得到它
 * - 注册表按前缀分层，所以两个前缀各列自己的工具
 * - 客户端发保留 id，旧服务端 404 时退回「GET 前缀根」的旧写法
 *
 * Mailbox 侧同样钉一遍（它没有 method，只有 `rpc-act`）：「无 toolId + list/get」现在只是一个
 * 寻址结果，不再是 `onReceive` 里的分叉，所以身份、校验、超时都覆盖它。
 *
 * 单元级分工：`src/transports/route-table.test.ts` 钉路由表与寻址规则；这里钉客户端真的能观察到什么。
 */

/** 架构层策略的探针：记录 Manager 实际看到哪些调用（以前看不到发现调用）。 */
class PolicyManager extends RpcTransportManager {
  public seen: Array<{ toolId: string, apiUrl: string }> = []
  /** 按工具 id 拒绝：这就是「谁能调哪个 API」该落的地方（设计文档 §10）。 */
  public denied = new Set<string>()

  public validateRpcRequest(request: any) {
    this.seen.push({ toolId: request.toolId, apiUrl: request.apiUrl })
    if (this.denied.has(request.toolId)) {
      // 403：「谁能调哪个 API」归 Manager（设计文档 §10），不在身份策略也不在 transport
      throw new RpcError(`Denied by manager policy: ${request.toolId}`, 403)
    }
    return super.validateRpcRequest(request)
  }
}

describe('discovery end-to-end over HTTP: 它是内置工具，不是旁路', () => {
  class AlphaTools extends ServerTools {}
  class BetaTools extends ServerTools {}

  let server: HttpServerToolTransport
  let client: HttpClientToolTransport
  let apiRoot: string
  let manager: PolicyManager

  beforeAll(async () => {
    ToolFunc.items = {}
    AlphaTools.items = {}
    BetaTools.items = {}

    new (AlphaTools as any)('alpha', { params: {}, func: () => 'alpha', isApi: true }).register()
    new (BetaTools as any)('beta', { params: {}, func: () => 'beta', isApi: true }).register()

    manager = new PolicyManager()

    await withReservedPort(3411, async (port) => {
      apiRoot = `http://localhost:${port}/api`
      server = new HttpServerToolTransport({ port, apiUrl: apiRoot, manager })
      server.addRpcHandler(apiRoot, { registry: AlphaTools })
      server.addDiscoveryHandler(apiRoot, () => AlphaTools.toJSON())
      await server.start({ port, host: 'localhost' })
    }, 'localhost')

    client = new HttpClientToolTransport(apiRoot)
  })

  afterAll(async () => {
    await server.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  it('客户端 loadApis() 打到保留 id，清单照常拿到', async () => {
    manager.seen.length = 0
    const apis = await client.loadApis()

    expect(Object.keys(apis).sort()).toEqual(['alpha'])
    // Manager 看到的是工具调用，不是一个它看不见的旁路
    expect(manager.seen).toContainEqual({ toolId: RPC_APIS_TOOL_ID, apiUrl: apiRoot })
  })

  it('架构层策略能拒掉发现调用（以前它绕得过 validateRpcRequest）', async () => {
    manager.denied.add(RPC_APIS_TOOL_ID)

    await expect(client.loadApis()).rejects.toMatchObject({ code: 403 })

    manager.denied.delete(RPC_APIS_TOOL_ID)
    expect(Object.keys(await client.loadApis())).toContain('alpha')
  })

  it('发现端点也在 globalTimeout 管辖内（慢清单会被掐掉）', async () => {
    // 以前发现不经 dispatcher，服务端侧超时对它无效。现在它就是工具调用，同一个死线控制器管得到。
    await withReservedPort(3412, async (port) => {
      const slowRoot = `http://localhost:${port}/api`
      const slowServer = new HttpServerToolTransport({
        port,
        apiUrl: slowRoot,
        dispatcher: new RpcServerDispatcher({ globalTimeout: 60, terminationGraceMs: 10 }),
      })
      slowServer.addRpcHandler(slowRoot, { registry: AlphaTools })
      slowServer.addDiscoveryHandler(slowRoot, async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
        return AlphaTools.toJSON()
      })
      await slowServer.start({ port, host: 'localhost' })

      try {
        await expect(new HttpClientToolTransport(slowRoot).loadApis()).rejects.toMatchObject({
          code: RpcStatusCode.GATEWAY_TIMEOUT,
        })
      } finally {
        await slowServer.stop()
      }
    }, 'localhost')
  })
})

describe('discovery end-to-end over HTTP: 认证、多前缀、旧服务端回退', () => {
   let authServer: HttpServerToolTransport
   let multiServer: HttpServerToolTransport
   let legacyServer: HttpServerToolTransport
   let authRoot: string
   let rootA: string
   let rootB: string
   let legacyRoot: string

   class OnlyA extends ServerTools {}
   class OnlyB extends ServerTools {}

   beforeAll(async () => {
      ToolFunc.items = {}
      OnlyA.items = {}
      OnlyB.items = {}
      new (OnlyA as any)('tool-a', { params: {}, func: () => 'a', isApi: true }).register()
      new (OnlyB as any)('tool-b', { params: {}, func: () => 'b', isApi: true }).register()

      // 1）发现端点要求认证：谓词按 toolId 判，与业务 API 同一套
      await withReservedPort(3421, async (port) => {
         authRoot = `http://localhost:${port}/api`
         authServer = new HttpServerToolTransport({
            port,
            apiUrl: authRoot,
            identity: new RpcBearerPolicy({
               allowAnonymous: (ctx) => ctx.toolId !== RPC_APIS_TOOL_ID,
               verify: (credential) => (credential === 'ok-token' ? { id: 'user-1' } : undefined),
            }),
         })
         authServer.addRpcHandler(authRoot, { registry: OnlyA })
         await authServer.start({ port, host: 'localhost' })
      }, 'localhost')

      // 2）同一 transport 服务两个前缀，各自一份注册表
      await withReservedPort(3431, async (port) => {
         rootA = `http://localhost:${port}/a`
         rootB = `http://localhost:${port}/b`
         multiServer = new HttpServerToolTransport({ port, apiUrl: `http://localhost:${port}/a` })
         multiServer.addRpcHandler(rootA, { registry: OnlyA })
         multiServer.addRpcHandler(rootB, { registry: OnlyB })
         await multiServer.start({ port, host: 'localhost' })
      }, 'localhost')

      // 3）旧服务端模拟：`rpcApis` 不是内置工具（业务侧占用了这个名字，报 404），
      //    发现仍由「GET 前缀根」提供（第三方用同一个 addRoute 声明的就是这条旧路由）
      await withReservedPort(3441, async (port) => {
         legacyRoot = `http://localhost:${port}/api`
         legacyServer = new HttpServerToolTransport({ port, apiUrl: legacyRoot })
         legacyServer.addRpcHandler(legacyRoot, {
            registry: {
               toJSON: () => ({ legacy: { name: 'legacy' } }),
               get: (id: string) => {
                  // `rpcApis` 在旧服务端上不是一个内置工具 → 报 404（客户端就该退回旧写法）
                  if (id === RPC_APIS_TOOL_ID) {
                     return { timeout: 0, run: () => {throw new RpcError(`Tool not found: ${id}`, RpcStatusCode.NOT_FOUND);} };
                  }
                  // 旧写法的那条路由：GET 前缀根，由第三方自己声明（同一个 addRoute）
                  if (id === 'legacyRoot') {
                     return { timeout: 0, run: () => ({ legacy: { name: 'legacy' } }) };
                  }
                  return undefined;
               },
            },
         })
         // 三行内置声明全部改指旧服务端的发现处理：它没有 `rpcApis` 这个内置工具，
         // 发现就是「GET 前缀根」那一条（第三方用同一个 addRoute 声明）。
         legacyServer.addRoute(legacyRoot, { path: '/', when: { method: 'GET' }, toolId: 'legacyRoot' })
         legacyServer.addRoute(legacyRoot, { path: '/', when: { act: 'list' }, toolId: 'legacyRoot' })
         legacyServer.addRoute(legacyRoot, { path: '/', when: { act: 'get' }, toolId: 'legacyRoot' })
         await legacyServer.start({ port, host: 'localhost' })
      }, 'localhost')
   })

   afterAll(async () => {
      await authServer.stop()
      await multiServer.stop()
      await legacyServer.stop()
      ToolFunc.items = {}
      ServerTools.items = {}
      ClientTools.items = {}
   })

   it('发现端点可以要求认证：无凭证 401，带凭证拿到清单', async () => {
      await expect(new HttpClientToolTransport(authRoot).loadApis()).rejects.toMatchObject({
         code: RpcStatusCode.UNAUTHENTICATED, status: 'unauthenticated',
      })

      const apis = await new HttpClientToolTransport(authRoot).loadApis({
         headers: { authorization: 'Bearer ok-token' },
      })
      expect(Object.keys(apis)).toContain('tool-a')
   })

   it('业务 API 不受影响：匿名仍可调用没被策略要求的工具', async () => {
      const res = await fetch(`${authRoot}/tool-a`, { method: 'GET' })
      expect(res.status).toBe(200)
      expect(await res.json()).toBe('a')
   })

   it('两个前缀各列自己的工具（注册表按前缀分层，不再共用最后一个）', async () => {
      const apisA = await new HttpClientToolTransport(rootA).loadApis()
      const apisB = await new HttpClientToolTransport(rootB).loadApis()

      expect(Object.keys(apisA)).toEqual(['tool-a'])
      expect(Object.keys(apisB)).toEqual(['tool-b'])
   })

   it('客户端发保留 id，旧服务端 404 时退回 GET 前缀根', async () => {
      const apis = await new HttpClientToolTransport(legacyRoot).loadApis()
      expect(apis.legacy).toBeDefined()
   })

   it('ClientTools.loadFrom() 走同一条路（类级凭证能过认证）', async () => {
      RpcClientTransportManager.bindScheme('http', HttpClientToolTransport)
      ClientTools.items = {}
      ClientTools.apiUrl = undefined
      ClientTools.fetchOptions = { headers: { authorization: 'Bearer ok-token' } }
      try {
         const items = await ClientTools.loadFrom(undefined, { apiUrl: authRoot })
         expect(Object.keys(items!)).toContain('tool-a')
      } finally {
         ClientTools.fetchOptions = {}
      }
   })
})

describe('discovery end-to-end over Mailbox: 没有 method，只有 act', () => {
   let mailbox: Mailbox
   let server: MailboxServerTransport
   let client: MailboxClientTransport
   let manager: PolicyManager

   class MbTools extends ServerTools {}
   const ADDR = 'mem://discovery-srv@mailbox/api'

   beforeAll(async () => {
      ToolFunc.items = {}
      MbTools.items = {}
      new (MbTools as any)('mb-tool', { params: {}, func: () => 'mb', isApi: true }).register()

      mailbox = new Mailbox()
      mailbox.registerProvider(new MemoryProvider())
      manager = new PolicyManager()

      server = new MailboxServerTransport({ mailbox, apiUrl: ADDR, manager })
      // 注册表挂在 claim 上：内置 `rpcApis` 就从这里取清单（与 HTTP 侧同一分层规则）
      server.addRpcHandler(ADDR, { registry: MbTools })
      await server.start()

      client = new MailboxClientTransport({
         mailbox,
         apiUrl: ADDR,
         clientAddress: 'mem://discovery-cli@mailbox/inbox',
         timeout: 2000,
      })
      await client.start()
   })

   afterAll(async () => {
      await client.stop()
      await server.stop()
      ToolFunc.items = {}
      ServerTools.items = {}
      ClientTools.items = {}
   })

   it('无 rpc-fn 的 list 经路由表寻址到内置工具，Manager 看得到这次调用', async () => {
      manager.seen.length = 0
      const apis = await client.fetch('', undefined, 'list')

      expect(Object.keys(apis)).toContain('mb-tool')
      expect(manager.seen).toContainEqual({ toolId: RPC_APIS_TOOL_ID, apiUrl: ADDR })
   })

   it('loadApis() 发保留 id（带 rpc-fn），同一份清单', async () => {
      const apis = await client.loadApis()
      expect(Object.keys(apis)).toContain('mb-tool')
   })

   it('架构层策略拒掉发现调用：403 经消息总线回客户端', async () => {
      manager.denied.add(RPC_APIS_TOOL_ID)
      try {
         let thrown: any
         try {
            await client.loadApis()
         } catch (err) {
            thrown = err
         }
         expect(thrown?.code ?? thrown?.error?.code).toBe(403)
      } finally {
         manager.denied.delete(RPC_APIS_TOOL_ID)
      }
   })

   it('旧客户端（不写 rpc-fn，只写 act: get）也命中内置行', async () => {
      const apis = await client.fetch('', undefined, 'get')
      expect(Object.keys(apis)).toContain('mb-tool')
   })
})

describe('discovery end-to-end over Mailbox: 认证与兼容外壳', () => {
   let authMailbox: Mailbox
   let authServer: MailboxServerTransport
   let authClient: MailboxClientTransport
   let legacyMailbox: Mailbox
   let legacyServer: MailboxServerTransport
   let legacyClient: MailboxClientTransport

   const AUTH_ADDR = 'mem://discovery-auth@mailbox/api'
   const LEGACY_ADDR = 'mem://discovery-legacy@mailbox/api'

   beforeAll(async () => {
      ToolFunc.items = {}
      ServerTools.items = {}
      new (class extends ServerTools {})('guarded', { params: {}, func: () => 'g', isApi: true }).register()

      // 1）发现端点要求认证：与 HTTP 侧同一个谓词写法（比 toolId，不比 builtin）
      authMailbox = new Mailbox()
      authMailbox.registerProvider(new MemoryProvider())
      authServer = new MailboxServerTransport({
         mailbox: authMailbox,
         apiUrl: AUTH_ADDR,
         identity: new RpcBearerPolicy({
            allowAnonymous: (ctx) => ctx.toolId !== RPC_APIS_TOOL_ID,
            verify: (credential) => (credential === 'mb-token' ? { id: 'mb-user' } : undefined),
         }),
      })
      authServer.addRpcHandler(AUTH_ADDR)
      await authServer.start()
      authClient = new MailboxClientTransport({
         mailbox: authMailbox,
         apiUrl: AUTH_ADDR,
         clientAddress: 'mem://discovery-auth-cli@mailbox/inbox',
         timeout: 2000,
      })
      await authClient.start()

      // 2）旧 API：addDiscoveryHandler 的 handler 仍是该前缀的 `rpcApis` 实现
      legacyMailbox = new Mailbox()
      legacyMailbox.registerProvider(new MemoryProvider())
      legacyServer = new MailboxServerTransport({ mailbox: legacyMailbox, apiUrl: LEGACY_ADDR })
      legacyServer.addRpcHandler(LEGACY_ADDR)
      legacyServer.addDiscoveryHandler(LEGACY_ADDR, () => ({ custom: { name: 'custom', customField: 1 } }))
      await legacyServer.start()
      legacyClient = new MailboxClientTransport({
         mailbox: legacyMailbox,
         apiUrl: LEGACY_ADDR,
         clientAddress: 'mem://discovery-legacy-cli@mailbox/inbox',
         timeout: 2000,
      })
      await legacyClient.start()
   })

   afterAll(async () => {
      await authClient.stop()
      await authServer.stop()
      await legacyClient.stop()
      await legacyServer.stop()
      ToolFunc.items = {}
      ServerTools.items = {}
      ClientTools.items = {}
   })

   it('不带凭证：发现调用 401（以前它不经管道，拦不到）', async () => {
      let thrown: any
      try {
         await authClient.loadApis()
      } catch (err) {
         thrown = err
      }
      expect(thrown?.code ?? thrown?.error?.code).toBe(RpcStatusCode.UNAUTHENTICATED)
   })

   it('带凭证：MailMessage.headers 的 authorization 也认，清单拿到', async () => {
      const apis = await authClient.loadApis({ headers: { authorization: 'Bearer mb-token' } })
      expect(Object.keys(apis)).toContain('guarded')
   })

   it('addDiscoveryHandler 仍是兼容外壳：清单来自 handler，不是注册表', async () => {
      const apis = await legacyClient.loadApis()
      expect(Object.keys(apis)).toEqual(['custom'])
      expect((apis as any).custom.customField).toBe(1)
   })
})
