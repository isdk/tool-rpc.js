import { ToolFunc } from '@isdk/tool-func'
import { ServerTools } from "../src/server-tools"
import { RpcMethodsServerTool } from "../src/rpc-methods-server-tool"
import { ResServerTools } from "../src/res-server-tools"

describe('Discovery Hierarchy and Compatibility', () => {
  function clearItems(items: any) {
    for (const key of Object.keys(items)) {
      delete items[key]
    }
  }

  beforeEach(() => {
    clearItems((ToolFunc as any).items)
  })

  it('should implement specialized isolation (Server vs RPC/Res)', () => {
    // 1. Base ToolFunc with isApi
    ToolFunc.register({ name: 'raw-api', func: () => 0, isApi: true })

    // 2. ServerTools instance
    ServerTools.register(new ServerTools({ name: 'srv-tool', func: () => 1 }))

    // 3. RpcMethodsServerTool instance
    RpcMethodsServerTool.register(new RpcMethodsServerTool({ name: 'rpc-tool', func: () => 2 }))

    // 4. ResServerTools instance
    ResServerTools.register(new ResServerTools({ name: 'res-tool', func: () => 3 }))

    // --- ServerTools Discovery ---
    const srvJson = ServerTools.toJSON()
    const srvKeys = Object.keys(srvJson)
    expect(srvKeys).toContain('raw-api')
    expect(srvKeys).toContain('srv-tool')
    // IMPORTANT: Absolutely NOT include Rpc/Res (Specialized dispatchers)
    expect(srvKeys).not.toContain('rpc-tool')
    expect(srvKeys).not.toContain('res-tool')

    // --- RpcMethodsServerTool Discovery ---
    const rpcJson = RpcMethodsServerTool.toJSON()
    const rpcKeys = Object.keys(rpcJson)
    expect(rpcKeys).toContain('rpc-tool')
    // IMPORTANT: INCLUDES ResServerTools (Compatible specialization)
    expect(rpcKeys).toContain('res-tool')
    // Should NOT include base ServerTools
    expect(rpcKeys).not.toContain('srv-tool')
    // raw ToolFunc 不兼容 rpcMethodsServerTool
    expect(rpcKeys).not.toContain('raw-api')

    // --- ResServerTools Discovery ---
    const resJson = ResServerTools.toJSON()
    const resKeys = Object.keys(resJson)
    expect(resKeys).toContain('res-tool')
    // IMPORTANT: EXCLUDES parent RpcMethodsServerTool (Upward isolation)
    expect(resKeys).not.toContain('rpc-tool')
    // Should NOT include base ServerTools
    expect(resKeys).not.toContain('srv-tool')
    // raw ToolFunc 不兼容 resServerTools
    expect(resKeys).not.toContain('raw-api')
  })

  it('should support custom subclasses and maintain discovery level', () => {
    class MyRpcTools extends RpcMethodsServerTool {}

    // This custom subclass will share the toJSON reference of RpcMethodsServerTool
    const myTool = new MyRpcTools({ name: 'my-rpc', func: () => 'ok' })
    RpcMethodsServerTool.register(myTool)

    // Should be discovered by RpcMethodsServerTool
    expect(Object.keys(RpcMethodsServerTool.toJSON())).toContain('my-rpc')

    // Should NOT be discovered by ServerTools (Incompatible base level)
    expect(Object.keys(ServerTools.toJSON())).not.toContain('my-rpc')
  })

  it('should respect isApi flag across hierarchy', () => {
    RpcMethodsServerTool.register({ name: 'hidden-rpc', func: () => 'h', isApi: false })
    ResServerTools.register({ name: 'hidden-res', func: () => 'h', isApi: false })

    expect(Object.keys(RpcMethodsServerTool.toJSON())).not.toContain('hidden-rpc')
    expect(Object.keys(RpcMethodsServerTool.toJSON())).not.toContain('hidden-res')
  })

  it('should work with named function registration', () => {
    function myTool() { return 'ok' }
    // By default, a raw function registered via ServerTools
    // without explicit class instance will have isApi: true implied if passed as config
    ServerTools.register({ name: 'func-tool', func: myTool, isApi: true })

    expect(Object.keys(ServerTools.toJSON())).toContain('func-tool')
    expect(Object.keys(RpcMethodsServerTool.toJSON())).not.toContain('func-tool')
  })
})
