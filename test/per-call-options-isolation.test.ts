// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { withReservedPort } from './helpers/ports'
import { ToolFunc } from '@isdk/tool-func'
import { HttpClientToolTransport } from '../src/transports/http-client'
import { HttpServerToolTransport } from '../src/transports/http-server'
import { RpcServerDispatcher } from '../src/transports/dispatcher'
import { RpcClientTransportManager } from '../src/transports/client-manager'
import { ServerTools } from '../src/server-tools'
import { ClientTools } from '../src/client-tools'

const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 每次调用的 `fetchOptions` 不该变成 transport 实例的默认值。
 *
 * 链路：`ClientTools.fetch()` 把自己合并出来的 `fetchOptions` 顺手交给
 * `RpcClientTransportManager.getClient(apiUrl, fetchOptions)`；`getClient` 没有缓存时
 * `new TransportClass(apiUrl, options)`，而 `ToolTransport` 里是 `this.options = options`
 * （**存的是引用**）。紧接着 `ClientToolTransport.fetch()` 的超时协商又**就地**改这个对象
 * （`fetchOptions.timeout = { value: ... }`、`fetchOptions.headers[...] = ...`）。
 * 于是「本次调用」的 timeout / headers 被写进了实例默认值，而实例是按 apiUrl 缓存的
 * ——这个 apiUrl 在这个进程里**后续所有调用**都带上它。
 */
describe('每次调用的 fetchOptions 不会变成 transport 实例的默认值', () => {
  let server: HttpServerToolTransport
  let apiRoot: string

  beforeAll(async () => {
    ToolFunc.items = {}
    const serverItems: Record<string, any> = {}
    ServerTools.items = serverItems

    RpcServerDispatcher.instance.registry = ServerTools
    RpcClientTransportManager.bindScheme('http', HttpClientToolTransport)

    ServerTools.register({
      name: 'slow',
      params: { ms: { type: 'number' } },
      func: async function ({ ms }: { ms: number }) {
        await settle(ms)
        return 'slow-ok'
      } as any,
      isApi: true,
    })

    await withReservedPort(3291, async (port) => {
      apiRoot = `http://localhost:${port}/api`
      server = new HttpServerToolTransport({ port, apiUrl: apiRoot })
      server.addRpcHandler(apiRoot)
      await server.start({ port, host: 'localhost' })
    }, 'localhost')
  })

  afterAll(async () => {
    await server?.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    await RpcClientTransportManager.instance.stopAll()
    RpcClientTransportManager.clearSchemes()
  })

  it('第一次调用带的 timeout 不会钉死这个 apiUrl 的后续调用', async () => {
    // 每个用例一个全新的 apiUrl：这样"谁是第一个建 transport 的"是确定的，
    // 不靠别的用例先跑。
    const freshRoot = `${apiRoot}/per-call-timeout`
    const Srv = ClientTools.connect(freshRoot)
    Srv.loadFromSync({ slow: { name: 'slow' } as any }, freshRoot)

    // 第一次：1ms 死线，必然超时——这一步同时把 transport 实例建了出来。
    await expect(Srv.get('slow')!.run({ ms: 30 }, { timeout: 1 }))
      .rejects.toMatchObject({ code: 504 })

    // 第二次：不传 timeout。现状（有 bug）是它继承第一次的 1ms → 也 504。
    const result = await Srv.get('slow')!.run({ ms: 30 })
    expect(result).toBe('slow-ok')
  })

  it('第一次调用带的凭证不会变成后续调用的默认 header', async () => {
    const freshRoot = `${apiRoot}/per-call-headers`
    const Srv = ClientTools.connect(freshRoot)
    Srv.loadFromSync({ slow: { name: 'slow' } as any }, freshRoot)

    // 探针挂在**原型**上：不能先 `getClient(freshRoot)` 拿实例——那等于"由我第一个建实例"，
    // 实例默认值就成了我这次传的（干净）参数，bug 反而被这条测试自己抹掉。
    const proto: any = HttpClientToolTransport.prototype
    const original = proto._fetch
    const seen: Array<Record<string, string>> = []
    proto._fetch = function (this: any, name: string, args: any, act: any, id: any, fo: any) {
      seen.push({ ...(fo?.headers ?? {}) })
      return original.call(this, name, args, act, id, fo)
    }

    try {
      await Srv.get('slow')!.run({ ms: 1 }, { headers: { authorization: 'Bearer caller-one' } })
      await Srv.get('slow')!.run({ ms: 1 })   // 换一个调用方：不带凭证
    } finally {
      proto._fetch = original
    }

    expect(seen).toHaveLength(2)
    expect(seen[0].authorization).toBe('Bearer caller-one')
    // 现状（有 bug）：第二次也带上第一次那个调用方的 token —— 跨调用方凭证串线。
    expect(seen[1].authorization, '后续调用不该继承上一次调用的凭证').toBeUndefined()
  })

  it('不会就地改写调用方传进来的 fetchOptions 对象', async () => {
    const freshRoot = `${apiRoot}/per-call-mutation`
    const Srv = ClientTools.connect(freshRoot)
    Srv.loadFromSync({ slow: { name: 'slow' } as any }, freshRoot)

    const callerOptions: any = { timeout: 5000 }
    await Srv.get('slow')!.run({ ms: 1 }, callerOptions)

    // 这条目前是绿的：`run()` 没有把协商结果写回调用方的对象。留作回归护栏——
    // 上面两条的修法正是"别就地改对象"，顺手改错就会让这条红。
    expect(callerOptions.timeout, '不该把调用方的 timeout 就地换成 {value:…}').toBe(5000)
    expect(callerOptions.headers, '不该往调用方的对象上塞框架 header').toBeUndefined()
  })
})
