import { describe, it, expect, vi } from 'vitest';
import { RpcServerDispatcher } from './dispatcher';
import { ToolRpcRequest, RpcStatusCode } from './models';
import { ServerTools } from '../server-tools';

describe('V2 Pure Architecture (No Compatibility Layer)', () => {

    it('should work correctly with context when compatibility is disabled', async () => {
        // 1. 定义一个纯 V2 工具，它只依赖第二个参数 context
        const mockV2Func = vi.fn().mockImplementation((params, context) => {
            return {
                receivedParams: params,
                receivedId: context.resId,
                receivedAct: context.act,
                hasLegacyReq: params._req !== undefined,
                hasLegacyRes: params._res !== undefined
            };
        });

        const registry = {
            get: (id: string) => ({
                run: (params: any, context: any) => mockV2Func(params, context)
            })
        };

        // 2. 构造一个关闭兼容层的 Dispatcher
        const dispatcher = new RpcServerDispatcher({
            registry,
            compat: {
                enableParamBridge: false, // 不再把 id/act 注入 params
                enableContextInjection: false // 此开关主要控制 ServerTools 内部注入，Dispatcher 层面已不再主动调用 inject
            }
        });

        // 3. 发起一个具有资源 ID 和 Action 的请求
        const req: ToolRpcRequest = {
            apiUrl: 'http://test',
            toolId: 'userTool',
            requestId: 'req-v2',
            resId: 'user-123',
            act: 'update',
            params: { name: 'New Name' },
            headers: { 'x-custom': 'v2-header' }
        };

        const res = await dispatcher.dispatch(req);

        expect(res.status).toBe(RpcStatusCode.OK);
        expect(res.data.receivedParams).toEqual({ name: 'New Name' }); // 确保 params 是纯净的业务数据
        expect(res.data.receivedParams.id).toBeUndefined(); // 验证 enableParamBridge: false 生效
        expect(res.data.receivedId).toBe('user-123'); // 验证通过 context 拿到 ID
        expect(res.data.receivedAct).toBe('update'); // 验证通过 context 拿到 Action

        // 验证没有污染 params
        expect(res.data.hasLegacyReq).toBe(false);
    });

    it('should allow ServerTools to disable legacy compat individually', async () => {
        class PureV2Tool extends ServerTools {
            enableLegacyCompat = false; // 个别工具显式关闭兼容
            func(params: any, context: any) {
                return {
                    paramsId: params.id,
                    contextId: context.resId,
                    hasReq: params._req !== undefined
                };
            }
        }

        const tool = new PureV2Tool('pureTool');
        const context: any = { resId: '789', req: {} };
        const params: any = {};

        const result = tool.run(params, context);

        expect(result.contextId).toBe('789');
        expect(result.paramsId).toBeUndefined();
        expect(result.hasReq).toBe(false);
    });

    it('should verify that Dispatcher accurately passes AbortSignal in pure mode', async () => {
        const mockTool = {
            run: async (params: any, context: any) => {
                if (context.signal instanceof AbortSignal) return 'has-signal';
                return 'no-signal';
            }
        };
        const registry = { get: () => mockTool };
        const dispatcher = new RpcServerDispatcher({ registry });

        const req: ToolRpcRequest = {
            apiUrl: 'http://test', toolId: 't', requestId: '1', params: {}, headers: {}
        };

        const res = await dispatcher.dispatch(req);
        expect(res.data).toBe('has-signal');
    });
});
