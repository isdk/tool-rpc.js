// @vitest-environment node
// 隐式协议名（issue #15）：这些名字是线协议的一部分，既要有常量，也要有文档。
// 用例锁的是「常量 ↔ 实现」这一对耦合：任何一头改名，另一头会在这里红。
import { describe, expect, it } from 'vitest'
import { RPC_SPECIAL_ACTIONS, RPC_PARAM_KEYS } from '../src/consts'
import { RpcTaskResource } from '../src/transports/rpc-task'
import { ClientTools } from '../src/client-tools'
import { makeClientToolRpcCancelable } from '../src/client-tools-cancelable'
import { injectV1ContextToParams, bridgeContextToV1Params } from '../src/transports/compat'

describe('隐式协议名：常量与保留名（issue #15）', () => {
  it('取消的 act 名有常量，且与端点方法名成对（改一处必须两处一起改）', () => {
    expect(RPC_SPECIAL_ACTIONS.CANCEL).toBe('$cancel')
    // 路由是按方法名找 act 的（RpcMethodsServerTool.SpecialRpcMethodNames）：
    // 常量改了、方法名没改，客户端就发出一条没人接的 act。
    expect(typeof (RpcTaskResource.prototype as any)[RPC_SPECIAL_ACTIONS.CANCEL],
      '端点上必须有与常量同名的方法').toBe('function')
  })

  it('legacy compat 灌进 params 的名字取自常量', () => {
    const params: any = {}
    const signal = new AbortController().signal
    injectV1ContextToParams(params, { req: 'RAW-REQ', reply: 'RAW-RES', signal } as any)
    bridgeContextToV1Params({ req: 'RAW-REQ', reply: 'RAW-RES', signal } as any, params)

    expect(params[RPC_PARAM_KEYS.REQ]).toBe('RAW-REQ')
    expect(params[RPC_PARAM_KEYS.RES]).toBe('RAW-RES')
    expect(params[RPC_PARAM_KEYS.SIGNAL]).toBeInstanceOf(AbortSignal)
    expect(RPC_PARAM_KEYS.ABORTER).toBe('aborter')
  })

  it('cancelable 客户端：`aborter` 是保留名，放真值要当场说清是保留名冲突', async () => {
    // 不是 tool-func 那句没头没尾的 `aborter should be an AbortController`——
    // 调用方看不出自己踩了协议里的保留名。
    class Conflicting extends ClientTools {}
    makeClientToolRpcCancelable(Conflicting)
    const inst: any = new Conflicting('conflict-probe')

    const p = inst.fetch({ aborter: 'mine' })
    // 不能只报得清楚、连形状都碎掉：`p.task` 还得在（只是这条路上一进来就拒）
    expect(p.task, 'TaskPromise 形状要保住').toBeDefined()
    await expect(p).rejects.toThrow(/aborter/)
    await expect(inst.fetch({ aborter: 'mine' })).rejects.toThrow(/reserved/)
  })
})
