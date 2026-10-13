// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withReservedPort } from './helpers/ports'
import { ToolFunc } from '@isdk/tool-func'
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox'

import { HttpClientToolTransport } from '../src/transports/http-client'
import { HttpServerToolTransport } from '../src/transports/http-server'
import { MailboxClientTransport } from '../src/transports/mailbox-client'
import { MailboxServerTransport } from '../src/transports/mailbox-server'
import { RpcServerDispatcher } from '../src/transports/dispatcher'
import { ServerTools } from '../src/server-tools'
import { ClientTools } from '../src/client-tools'
import { RpcBearerPolicy } from '../src/transports/identity-bearer'
import { RpcSessionIdentityPolicy } from '../src/transports/identity-session'
import { RPC_HEADERS, RpcStatusCode } from '../src/transports/models'
import { RpcClientTransportManager } from '../src/transports/client-manager'

/**
 * 身份策略的端到端验证：真 socket / 真消息总线，走完整流水线
 * （`toRpcRequest` → `resolveRequestIdentity` → `validateRpcRequest` → dispatcher → 业务工具 → 响应）。
 *
 * 与 `src/transports/identity-server.test.ts` 的分工：那边用假 req/res 钉流水线插桩点与响应形状；
 * 这里钉「客户端真的能观察到什么」：401 到客户端手上是什么、`ctx.identity` 到业务侧是什么、
 * 凭证经响应头下发再带回来能不能续用同一个身份。
 *
 * 设计文档：根目录 `IDENTITY_POLICY_DESIGN.cn.md` §10（分工边界）、§11（P1b）、§14（回归名单）。
 */

/** 业务侧唯一读法：`ctx.identity`（`dispatcher.prepareContext` 从 `request.identity` 透传）。 */
const whoami = {
  name: 'whoami',
  params: {},
  // 业务侧读 ctx 的两条路都钉上：tool-func 影子实例上的 this.ctx，与 run(params, context) 的第二参
  func: async function (_params: any, argCtx: any) {
    const ctx = (this as any)?.ctx ?? argCtx
    return {
      identityId: ctx?.identity?.id,
      attributes: ctx?.identity?.attributes,
      authHeader: ctx?.headers?.['authorization'],
      hasCtx: ctx !== undefined,
    }
  } as any,
  isApi: true,
}

/** 计数器：证明 401 发生在业务之前（策略拒绝时工具一次都不跑）。 */
let whoamiCalls = 0

function resetRegistries() {
  ToolFunc.items = {}

  const serverItems: Record<string, any> = {}
  Object.setPrototypeOf(serverItems, ToolFunc.items)
  ServerTools.items = serverItems

  const clientItems: Record<string, any> = {}
  Object.setPrototypeOf(clientItems, ToolFunc.items)
  ClientTools.items = clientItems

  RpcServerDispatcher.instance.registry = ServerTools

  whoamiCalls = 0
  ServerTools.register({
    ...whoami,
    func: async function (params: any, ctx: any) {
      whoamiCalls += 1
      return whoami.func.call(this, params, ctx)
    },
  })
}

describe('identity end-to-end over HTTP', () => {
  let server: HttpServerToolTransport
  let client: HttpClientToolTransport
  let apiRoot: string
  const verified: string[] = []

  const bearerPolicy = () => new RpcBearerPolicy({
    allowAnonymous: false,
    verify: (credential: string) => {
      verified.push(credential)
      return credential === 'e2e-token'
        ? { id: 'user-alice', attributes: { scope: ['read'] } }
        : undefined
    },
  })

  beforeAll(async () => {
    resetRegistries()

    await withReservedPort(3171, async (port) => {
      apiRoot = `http://localhost:${port}/api`
      server = new HttpServerToolTransport({ port, apiUrl: apiRoot, identity: bearerPolicy() })
      server.addRpcHandler(apiRoot)
      await server.start({ port, host: 'localhost' })
    }, 'localhost')

    client = new HttpClientToolTransport(apiRoot)
    RpcClientTransportManager.instance.register(client)
    ClientTools.apiUrl = client.apiUrl
  })

  afterAll(async () => {
    await server.stop()
    ClientTools.fetchOptions = undefined
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  it('不带凭证：客户端拿到 401 + unauthenticated，业务工具一次都没跑', async () => {
    let thrown: any
    try {
      await client._fetch('whoami', {}, 'run')
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain('RPC Error [401]')
    expect(thrown.code).toBe(RpcStatusCode.UNAUTHENTICATED)
    expect(thrown.status).toBe('unauthenticated')
    expect(whoamiCalls).toBe(0)
    expect(verified).toHaveLength(0)
  })

  it('带合法 Bearer：200，业务侧 ctx.identity 就是 verify 的产物', async () => {
    const res = (await client._fetch('whoami', {}, 'run', undefined, {
      headers: { authorization: 'Bearer e2e-token' },
    })) as Response

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.identityId).toBe('user-alice')
    expect(body.attributes).toEqual({ scope: ['read'] })
    expect(verified).toEqual(['e2e-token'])
  })

  it('伪造凭证：verify 不认 → 同样 401（与不带凭证同形状）', async () => {
    await expect(client._fetch('whoami', {}, 'run', undefined, {
      headers: { authorization: 'Bearer forged' },
    })).rejects.toMatchObject({ code: 401, status: 'unauthenticated' })
  })

  it('内置 reader 覆盖大小写与 scheme 变体：bearer / 无 Bearer 前缀都认', async () => {
    for (const value of ['bearer e2e-token', 'Bearer  e2e-token', 'e2e-token']) {
      const res = (await client._fetch('whoami', {}, 'run', undefined, {
        headers: { authorization: value },
      })) as Response
      expect(res.status).toBe(200)
      expect((await res.json()).identityId).toBe('user-alice')
    }
  })

  it('装了策略后 clientId 由服务端判定值接管：客户端自报的 rpc-cli 不作身份', async () => {
    const res = (await client._fetch('whoami', {}, 'run', undefined, {
      headers: { authorization: 'Bearer e2e-token', [RPC_HEADERS.CLIENT_ID]: 'client-lies' },
    })) as Response

    const body = await res.json()
    // 接管后业务看到的身份就是 verify 的产物，不是客户端自报的 'client-lies'
    expect(body.identityId).toBe('user-alice')
    expect(body.hasCtx).toBe(true)
  })

  it('发现端点是框架的内置 API：装了策略也要过同一条判定（无凭证 401，带凭证能列工具）', async () => {
    const anon = await fetch(apiRoot, { method: 'GET' })
    expect(anon.status).toBe(401)
    const anonBody = await anon.json()
    expect(anonBody.error.code).toBe(RpcStatusCode.UNAUTHENTICATED)
    expect(anonBody.error.status).toBe('unauthenticated')

    const authed = await fetch(apiRoot, { method: 'GET', headers: { authorization: 'Bearer e2e-token' } })
    expect(authed.status).toBe(200)
    const apis = await authed.json()
    expect(apis.whoami).toBeDefined()
  })

  it('ClientTools 走完整客户端栈（loadFrom + run）：带默认凭证的调用正常返回', async () => {
    ClientTools.fetchOptions = { headers: { authorization: 'Bearer e2e-token' } }
    await ClientTools.loadFrom()

    const result = await ClientTools.get('whoami')!.run({})
    expect(result.identityId).toBe('user-alice')
    expect(result.attributes).toEqual({ scope: ['read'] })
  })

  it('ClientTools 不带凭证时把 401 原样抛给调用方', async () => {
    ClientTools.fetchOptions = {}

    let thrown: any
    try {
      await ClientTools.get('whoami')!.run({})
    } catch (err) {
      thrown = err
    }
    expect(thrown?.message).toMatch(/RPC Error \[401\]/)
    expect(thrown?.code).toBe(401)
  })
})

describe('identity end-to-end over HTTP: 逐 API 的认证判定', () => {
  /** 工具注册级元数据：继承 `ServerTools` 加字段，策略经 `ctx.tool` 读到（框架不解释它的含义）。 */
  class AdminTool extends ServerTools {
    authScope = 'admin'
    func() { return 'admin-ok' }
  }

  let server: HttpServerToolTransport
  let client: HttpClientToolTransport
  let apiRoot: string
  const seen: Array<{ toolId?: string, act?: string, resId?: string, scope?: string }> = []
  // 两个入口都记：`allowAnonymous` 只在没凭证/验不过时被调，`verify` 只在带了凭证时被调
  const record = (ctx: any) => seen.push({
    toolId: ctx.toolId, act: ctx.act, resId: ctx.resId,
    scope: (ctx.tool as any)?.authScope,
  })

  beforeAll(async () => {
    resetRegistries()

    ServerTools.register({ name: 'public', params: {}, func: async () => 'public-ok', isApi: true } as any)
    new AdminTool('admin').register()

    await withReservedPort(3211, async (port) => {
      apiRoot = `http://localhost:${port}/api`
      server = new HttpServerToolTransport({
        port,
        apiUrl: apiRoot,
        identity: new RpcBearerPolicy({
          // 逐 API：注册时带 `authScope` 的工具必须认证；其余（含内置发现端点 `rpcApis`）匿名可进
          allowAnonymous: (ctx) => {
            record(ctx)
            return ctx.toolId === 'rpcApis' || !(ctx.tool as any)?.authScope
          },
          verify: (credential, ctx) => {
            record(ctx)
            return credential === 'admin-token' ? { id: 'admin-user' } : undefined
          },
        }),
      })
      server.addRpcHandler(apiRoot)
      await server.start({ port, host: 'localhost' })
    }, 'localhost')

    client = new HttpClientToolTransport(apiRoot)
    seen.length = 0
  })

  afterAll(async () => {
    await server.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  it('同一个策略实例下：未标记的 API 匿名可进，带 authScope 的 API 必须凭证', async () => {
    const anonPublic = (await client._fetch('public', {}, 'run')) as Response
    expect(anonPublic.status).toBe(200)
    expect(await anonPublic.json()).toBe('public-ok')

    await expect(client._fetch('admin', {}, 'run')).rejects.toMatchObject({
      code: RpcStatusCode.UNAUTHENTICATED, status: 'unauthenticated',
    })

    const authedAdmin = (await client._fetch('admin', {}, 'run', undefined, {
      headers: { authorization: 'Bearer admin-token' },
    })) as Response
    expect(authedAdmin.status).toBe(200)
    expect(await authedAdmin.json()).toBe('admin-ok')
  })

  it('内置发现端点在谓词里单独放行：未认证也能列工具', async () => {
    const res = await fetch(apiRoot, { method: 'GET' })
    expect(res.status).toBe(200)
    const apis = await res.json()
    expect(apis.public).toBeDefined()
    expect(apis.admin).toBeDefined()
  })

  it('策略看到的备料：toolId / act / resId / tool（注册实例的自定义字段）', async () => {
    seen.length = 0

    await client._fetch('public', {}, 'run')
    await client._fetch('admin', {}, 'get', 'res-7', { headers: { authorization: 'Bearer admin-token' } })
    await fetch(apiRoot, { method: 'GET' })

    const publicCall = seen.find(entry => entry.toolId === 'public')
    const adminCall = seen.find(entry => entry.toolId === 'admin')
    // 内置发现端点不是例外：它就是一个普通 toolId，所以谓词里同一套字段就能判它
    const discoveryCall = seen.find(entry => entry.toolId === 'rpcApis')

    expect(publicCall).toMatchObject({ toolId: 'public', act: 'run' })
    expect(publicCall!.scope).toBeUndefined()

    expect(adminCall).toMatchObject({ toolId: 'admin', act: 'get', resId: 'res-7', scope: 'admin' })

    expect(discoveryCall).toMatchObject({ toolId: 'rpcApis', act: 'list' })
    expect(discoveryCall!.scope).toBeUndefined()
  })
})

describe('identity end-to-end over HTTP: 会话凭证下发再带回来', () => {
  /**
   * 凭证的 wire 位置归部署（契约 11）：框架侧只保证 `ctx.res` 是交付句柄。
   * 这里用子类把 `assign` 产出的 credential 写进响应头，演示唯一的官方逃生口。
   */
  class SessionHeaderTransport extends HttpServerToolTransport {
    protected async resolveRequestIdentity(rpcReq: any, rawReq?: any, rawRes?: any): Promise<void> {
      await super.resolveRequestIdentity(rpcReq, rawReq, rawRes)
      const credential = rpcReq.identity?.credential
      if (credential && rawRes && !rawRes.headersSent) {
        rawRes.setHeader('rpc-session', credential)
      }
    }
  }

  let serverNoReader: SessionHeaderTransport
  let serverWithReader: SessionHeaderTransport
  let clientNoReader: HttpClientToolTransport
  let clientWithReader: HttpClientToolTransport

  const firstCall = async (client: HttpClientToolTransport) => {
    const res = (await client._fetch('whoami', {}, 'run')) as Response
    expect(res.status).toBe(200)
    return { res, body: await res.json(), credential: res.headers.get('rpc-session') }
  }

  beforeAll(async () => {
    resetRegistries()

    // A：只配了下发（响应头），没配取回 reader —— 用来钉「框架不猜 header 名」
    await withReservedPort(3181, async (port) => {
      const apiRoot = `http://localhost:${port}/api`
      serverNoReader = new SessionHeaderTransport({ port, apiUrl: apiRoot, identity: new RpcSessionIdentityPolicy() })
      serverNoReader.addRpcHandler(apiRoot)
      await serverNoReader.start({ port, host: 'localhost' })
      clientNoReader = new HttpClientToolTransport(apiRoot)
    }, 'localhost')

    // B：下发与取回成对配齐（契约 9 + 契约 11）
    await withReservedPort(3191, async (port) => {
      const apiRoot = `http://localhost:${port}/api`
      serverWithReader = new SessionHeaderTransport({
        port,
        apiUrl: apiRoot,
        identity: new RpcSessionIdentityPolicy(),
        credentialReader: (req: any) => req?.headers?.['rpc-session'],
      })
      serverWithReader.addRpcHandler(apiRoot)
      await serverWithReader.start({ port, host: 'localhost' })
      clientWithReader = new HttpClientToolTransport(apiRoot)
    }, 'localhost')
  })

  afterAll(async () => {
    await serverNoReader.stop()
    await serverWithReader.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  it('首次连接签发凭证（经响应头下发），身份是服务端判定的连接级 uuid', async () => {
    const { body, credential } = await firstCall(clientNoReader)

    expect(credential).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.identityId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.attributes).toBeUndefined()
  })

  it('只配下发不配 reader：默认 reader 只读 authorization，私有 header 里的凭证拿不回来（每次新身份）', async () => {
    const first = await firstCall(clientNoReader)

    const again = (await clientNoReader._fetch('whoami', {}, 'run', undefined, {
      headers: { 'rpc-session': first.credential! },
    })) as Response
    expect((await again.json()).identityId).not.toBe(first.body.identityId)
  })

  it('下发与取回成对配齐：带回来的凭证续用同一个身份', async () => {
    const first = await firstCall(clientWithReader)

    const again = (await clientWithReader._fetch('whoami', {}, 'run', undefined, {
      headers: { 'rpc-session': first.credential! },
    })) as Response
    expect((await again.json()).identityId).toBe(first.body.identityId)

    // 契约 5：credential 只出现在 assign 的返回值里。match 命中不重新下发，
    // 所以续用靠的是客户端手上那张，不是服务端每请求重发
    const third = (await clientWithReader._fetch('whoami', {}, 'run', undefined, {
      headers: { 'rpc-session': first.credential! },
    })) as Response
    expect(third.headers.get('rpc-session')).toBeNull()
    expect((await third.json()).identityId).toBe(first.body.identityId)
  })

  it('会话策略不做认证：伪造凭证不拒绝，只换一个新身份', async () => {
    const first = await firstCall(clientWithReader)

    const forged = (await clientWithReader._fetch('whoami', {}, 'run', undefined, {
      headers: { 'rpc-session': 'not-a-real-session' },
    })) as Response
    expect(forged.status).toBe(200)
    expect((await forged.json()).identityId).not.toBe(first.body.identityId)
  })
})

describe('identity end-to-end over HTTP: 私有 header 的 bearer（契约 9）', () => {
  let server: HttpServerToolTransport
  let client: HttpClientToolTransport

  beforeAll(async () => {
    resetRegistries()

    await withReservedPort(3201, async (port) => {
      const apiRoot = `http://localhost:${port}/api`
      server = new HttpServerToolTransport({
        port,
        apiUrl: apiRoot,
        identity: new RpcBearerPolicy({
          allowAnonymous: false,
          verify: (credential: string) => (credential === 'proxy-1' ? { id: 'behind-proxy' } : undefined),
        }),
        credentialReader: (req: any) => req?.headers?.['x-proxy-token'],
      })
      server.addRpcHandler(apiRoot)
      await server.start({ port, host: 'localhost' })
      client = new HttpClientToolTransport(apiRoot)
    }, 'localhost')
  })

  afterAll(async () => {
    await server.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  it('authorization 里有值也不作凭证：reader 说了算（未认证 401）', async () => {
    // 故意用**能过 verify** 的值：否则 401 只是「token 无效」，钉不住「reader 权威」这条契约（issue #3）。
    // 这个请求是绕过代理直接递上来的：`verify` 不能拿到 `proxy-1`。
    await expect(client._fetch('whoami', {}, 'run', undefined, {
      headers: { authorization: 'Bearer proxy-1' },
    })).rejects.toMatchObject({ code: 401 })
  })

  it('私有 header 里的凭证经部署自己的 reader 生效', async () => {
    const res = (await client._fetch('whoami', {}, 'run', undefined, {
      headers: { 'x-proxy-token': 'proxy-1' },
    })) as Response
    expect((await res.json()).identityId).toBe('behind-proxy')
  })
})

describe('identity end-to-end over Mailbox', () => {
  let mailbox: Mailbox
  let server: MailboxServerTransport
  let client: MailboxClientTransport

  beforeAll(async () => {
    resetRegistries()

    mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider())

    server = new MailboxServerTransport({
      mailbox,
      apiUrl: 'mem://identity-srv@mailbox/api',
      identity: new RpcBearerPolicy({
        allowAnonymous: false,
        verify: (credential: string) => (credential === 'mb-token' ? { id: 'mb-alice' } : undefined),
      }),
    })
    server.addRpcHandler('mem://identity-srv@mailbox/api')
    await server.start()

    client = new MailboxClientTransport({
      mailbox,
      apiUrl: 'mem://identity-srv@mailbox/api',
      clientAddress: 'mem://identity-cli@mailbox/inbox',
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

  it('非 HTTP 协议共用同一个默认 reader：MailMessage.headers 的 authorization 也认', async () => {
    const result = await client.fetch('whoami', {}, 'run', undefined, {
      headers: { authorization: 'Bearer mb-token' },
    })
    expect(result.identityId).toBe('mb-alice')
  })

  it('不带凭证：401 经消息总线回客户端（错误封包带 code/status）', async () => {
    let thrown: any
    try {
      await client.fetch('whoami', {}, 'run')
    } catch (err) {
      thrown = err
    }
    expect(thrown?.code ?? thrown?.error?.code).toBe(RpcStatusCode.UNAUTHENTICATED)
    expect(String(thrown?.message ?? thrown?.error?.message)).toMatch(/Unauthenticated/)
  })
})
