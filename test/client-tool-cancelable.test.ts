// @vitest-environment node
// `makeClientToolRpcCancelable`（issue #11 的“客户端 task 句柄”那一半）：
// 让远程调用与本地调用同形——`p.task.abort()` 之后，服务端必须真的停下来，
// 而不是只把本地的 promise 断掉。判据都盯着服务端那一侧，不看客户端的 promise 形态。
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { withReservedPort } from './helpers/ports'
import { ToolFunc } from '@isdk/tool-func'
import { ServerTools } from '../src/server-tools'
import { ClientTools } from '../src/client-tools'
import { makeClientToolRpcCancelable } from '../src/client-tools-cancelable'
import { HttpClientToolTransport } from '../src/transports/http-client'
import { HttpServerToolTransport } from '../src/transports/http-server'
import { RpcClientTransportManager } from '../src/transports/client-manager'
import { RpcServerDispatcher } from '../src/transports/dispatcher'

class PlainClient extends ClientTools { }
class CancelableClient extends ClientTools { }

describe('makeClientToolRpcCancelable (issue #11)', () => {
  let httpServer: HttpServerToolTransport
  let httpClient: HttpClientToolTransport
  let apiRoot: string

  const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

  beforeAll(async () => {
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
    RpcServerDispatcher.instance.registry = ServerTools

    // 后台任务探针：断言只看它，不看客户端
    ;(globalThis as any).__CancelableProbe = {}
    ServerTools.register({
      name: 'bg-long',
      timeout: { value: 100, keepAliveOnTimeout: true },
      func: async function (this: any) {
        const key = (this as any).ctx?.requestId
        const state = ((globalThis as any).__CancelableProbe[key] ||= { started: true, aborted: false, finished: false })
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

    // 把服务端实际收到的参数名回显出来：客户端的本地句柄不能上 wire
    ServerTools.register({
      name: 'keys-echo',
      func: async function (params: any) {
        return Object.keys(params || {})
      } as any,
      isApi: true,
    })

    ServerTools.register({
      name: 'ping',
      func: async function (params: any) {
        return params?.msg ?? 'pong'
      } as any,
      isApi: true,
    })

    await withReservedPort(3022, async (p) => {
      apiRoot = `http://localhost:${p}/api`
      httpServer = new HttpServerToolTransport({ port: p, apiUrl: apiRoot })
      httpServer.addRpcHandler(apiRoot)
      await httpServer.start({ port: p, host: 'localhost' })
    }, 'localhost')

    httpClient = new HttpClientToolTransport(apiRoot)
    RpcClientTransportManager.instance.register(httpClient)

    makeClientToolRpcCancelable(CancelableClient)

    for (const Cls of [PlainClient, CancelableClient]) {
      // 类不设自己的 items 时，注册会落回基类的 `ClientTools.items`（`connect()` 就是这么隔离作域的）。
      // 两个类共用一张表的话，后一个类拿到的其实是前一个类建的实例——能力就看不见了。
      ;(Cls as any).items = {}
      Cls.apiUrl = apiRoot
      Cls.loadFromSync({
        'bg-long': { name: 'bg-long' } as any,
        'keys-echo': { name: 'keys-echo' } as any,
        'ping': { name: 'ping' } as any,
      }, apiRoot)
    }
  })

  afterAll(async () => {
    await httpServer.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  const trackerTasks = () => (RpcServerDispatcher.instance.tracker as any).tasks as Map<string, unknown>
  const probeOf = (reqId: string) => (globalThis as any).__CancelableProbe[reqId]
  const stubOf = (Cls: typeof ClientTools, name: string) => Cls.get(name) as any

  it('is opt-in: an untouched class has no task handle', async () => {
    const p = stubOf(PlainClient, 'ping').run({ msg: 'plain' })
    expect(p).toBeInstanceOf(Promise)
    expect(p.task, '没开能力的类不该凭空拿到 task 句柄').toBeUndefined()
    expect(await p).toBe('plain')
  })

  it('gives run() a task handle', async () => {
    const p = stubOf(CancelableClient, 'ping').run({ msg: 'with-task' })
    expect(typeof p.task?.abort, 'run() 要返回挂了 task 的 promise').toBe('function')
    expect(await p).toBe('with-task')
  })

  it('task.abort() after 102 stops the server-side task, clears the ledger, and keeps the channel alive', async () => {
    const reqId = `cancelable-abort-${Date.now().toString(36)}`
    const p = stubOf(CancelableClient, 'bg-long').run({}, { headers: { 'req-id': reqId } })

    await settle(250) // 已进 102 轮询
    expect(trackerTasks().has(reqId), '取消前任务应在后台账本里').toBe(true)

    p.task.abort('用户停止')

    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await settle(400)

    expect(probeOf(reqId)?.aborted, '服务端任务必须被中止').toBe(true)
    expect(probeOf(reqId)?.finished, '中止后不该跑完').toBe(false)
    expect(trackerTasks().has(reqId), '取消后账本不该残留').toBe(false)
    // 取消是逻辑的：同一条通道上的其它调用照走（issue #11 验收第 2 条）
    expect(await stubOf(CancelableClient, 'ping').run({ msg: 'after-cancel' })).toBe('after-cancel')
  })

  it('keeps working when AbortSignal.any is unavailable', async () => {
    const any = (AbortSignal as any).any
    delete (AbortSignal as any).any
    try {
      const reqId = `cancelable-no-any-${Date.now().toString(36)}`
      const p = stubOf(CancelableClient, 'bg-long').run({}, { headers: { 'req-id': reqId } })
      await settle(250)
      p.task.abort('no AbortSignal.any')
      await expect(p).rejects.toMatchObject({ name: 'AbortError' })
      await settle(400)
      expect(probeOf(reqId)?.aborted).toBe(true)
      expect(trackerTasks().has(reqId)).toBe(false)
    } finally {
      (AbortSignal as any).any = any
    }
  })

  it('still honours a caller-supplied signal alongside the task handle', async () => {
    const reqId = `cancelable-caller-signal-${Date.now().toString(36)}`
    const controller = new AbortController()
    const p = stubOf(CancelableClient, 'bg-long').run({}, { headers: { 'req-id': reqId }, signal: controller.signal })
    await settle(250)
    controller.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await settle(400)
    expect(probeOf(reqId)?.aborted, '调用方自带 signal 也要照样传到服务端').toBe(true)
  })

  it('runs concurrently on one stub (multi-task)', async () => {
    const stub = stubOf(CancelableClient, 'ping')
    const results = await Promise.all([
      stub.run({ msg: 'c1' }),
      stub.run({ msg: 'c2' }),
      stub.run({ msg: 'c3' }),
    ])
    expect(results).toEqual(['c1', 'c2', 'c3'])
  })

  it('never puts the local aborter on the wire', async () => {
    const keys = await stubOf(CancelableClient, 'keys-echo').run({ a: 1 })
    expect(keys).toContain('a')
    for (const leaked of ['aborter', 'signal', 'signals']) {
      expect(keys, `客户端本地句柄 ${leaked} 不该发到服务端`).not.toContain(leaked)
    }
  })
})
