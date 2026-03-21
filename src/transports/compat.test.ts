import { describe, it, expect, vi } from 'vitest';
import { bridgeContextToV1Params, bridgeV2RequestToV1Params, elevateV1ParamsToV2Request, injectV1ContextToParams } from './compat';
import { ToolRpcRequest, ToolRpcContext, RpcStatusCode } from './models';
import { RpcServerDispatcher } from './dispatcher';
import { ServerTools } from '../server-tools';

describe('Rpc Compatibility Layer (V2 to V1 Bridge)', () => {

    describe('bridgeV2RequestToV1Params', () => {
        it('should bridge id and act from request to params', () => {
            const req: ToolRpcRequest = {
                apiUrl: 'http://test',
                toolId: 'myTool',
                requestId: 'req-1',
                resId: 'res-123',
                act: 'get',
                params: { foo: 'bar' },
                headers: {}
            };

            const params = bridgeV2RequestToV1Params(req, { ...req.params });
            expect(params.id).toBe('res-123');
            expect(params.act).toBe('get');
            expect(params.foo).toBe('bar');
        });

        it('should NOT overwrite existing id/act in params', () => {
            const req: ToolRpcRequest = {
                apiUrl: 'http://test',
                toolId: 'myTool',
                requestId: 'req-1',
                resId: 'res-v2',
                act: 'act-v2',
                params: { id: 'res-v1', act: 'act-v1' },
                headers: {}
            };

            const params = bridgeV2RequestToV1Params(req, { ...req.params });
            expect(params.id).toBe('res-v1');
            expect(params.act).toBe('act-v1');
        });

        it('should handle missing id or act in request', () => {
            const req: ToolRpcRequest = {
                apiUrl: 'http://test',
                toolId: 'myTool',
                requestId: 'req-1',
                params: { baz: 1 },
                headers: {}
            };

            const params = bridgeV2RequestToV1Params(req, { ...req.params });
            expect(params.id).toBeUndefined();
            expect(params.act).toBeUndefined();
            expect(params.baz).toBe(1);
        });
    });

    describe('elevateV1ParamsToV2Request', () => {
        it('should elevate id and act from params to request', () => {
            const req: any = {
                params: { id: 'p-id', act: 'p-act', other: 1 }
            };
            elevateV1ParamsToV2Request(req);
            expect(req.resId).toBe('p-id');
            expect(req.act).toBe('p-act');
        });

        it('should NOT overwrite existing resId/act in request', () => {
            const req: any = {
                resId: 'r-id',
                act: 'r-act',
                params: { id: 'p-id', act: 'p-act' }
            };
            elevateV1ParamsToV2Request(req);
            expect(req.resId).toBe('r-id');
            expect(req.act).toBe('r-act');
        });

        it('should convert non-string params to string', () => {
            const req: any = { params: { id: 123, act: true } };
            elevateV1ParamsToV2Request(req);
            expect(req.resId).toBe('123');
            expect(req.act).toBe('true');
        });
    });

    describe('bridgeContextToV1Params', () => {
        it('should bridge resId/act from context to params', () => {
            const ctx: any = { resId: 'c-id', act: 'c-act' };
            const params: any = { data: 1 };
            const result = bridgeContextToV1Params(ctx, params);
            expect(result.id).toBe('c-id');
            expect(result.act).toBe('c-act');
        });
    });

    describe('injectV1ContextToParams', () => {
        it('should inject context into params private properties', () => {
            const params: any = {};
            const mockReq = { url: '/api' };
            const mockReply = { status: 200 };
            const mockSignal = new AbortController().signal;

            const ctx: ToolRpcContext = {
                requestId: 'req-1',
                headers: {},
                req: mockReq,
                reply: mockReply,
                signal: mockSignal
            };

            injectV1ContextToParams(params, ctx);

            expect(params._req).toBe(mockReq);
            expect(params._res).toBe(mockReply);
            expect(params._signal).toBe(mockSignal);
        });

        it('should NOT overwrite existing private properties in params', () => {
            const params: any = { _req: 'old-req' };
            const ctx: ToolRpcContext = {
                requestId: 'req-1',
                headers: {},
                req: 'new-req'
            };

            injectV1ContextToParams(params, ctx);
            expect(params._req).toBe('old-req');
        });

        it('should ignore non-object params', () => {
            expect(() => injectV1ContextToParams(null, {} as any)).not.toThrow();
            expect(() => injectV1ContextToParams("string", {} as any)).not.toThrow();
        });
    });

    describe('Integration with Dispatcher', () => {
        it('should respect enableParamBridge: false in Dispatcher', async () => {
            const mockTool = {
                run: vi.fn().mockResolvedValue('ok')
            };
            const registry = { get: () => mockTool };
            const dispatcher = new RpcServerDispatcher({
                registry,
                compat: { enableParamBridge: false, enableContextInjection: false }
            });

            const req: ToolRpcRequest = {
                apiUrl: 'http://test',
                toolId: 'tool',
                requestId: '1',
                resId: 'res-id',
                params: {},
                headers: {}
            };

            await dispatcher.dispatch(req);

            // Check first argument of the first call
            const executedParams = mockTool.run.mock.calls[0][0];
            expect(executedParams.id).toBeUndefined();
        });
    });

    describe('Integration with ServerTools', () => {
        it('should respect enableLegacyCompat: false in ServerTools', () => {
            class MyTool extends ServerTools {
                enableLegacyCompat = false;
                func = vi.fn().mockReturnValue('ok');
            }
            const tool = new MyTool('test');
            const params = {};
            const ctx: ToolRpcContext = { requestId: '1', headers: {}, req: 'foo' };

            tool.run(params, ctx);

            expect(tool.func).toHaveBeenCalled();
            const passedParams = tool.func.mock.calls[0][0];
            expect(passedParams._req).toBeUndefined();
        });

        it('should perform injection when enableLegacyCompat is true (default)', () => {
            class MyTool extends ServerTools {
                func = vi.fn().mockReturnValue('ok');
            }
            const tool = new MyTool('test');
            const params = {};
            const ctx: ToolRpcContext = { requestId: '1', headers: {}, req: 'foo' };

            tool.run(params, ctx);

            const passedParams = tool.func.mock.calls[0][0];
            expect(passedParams._req).toBe('foo');
        });
    });

    describe('Boundary Cases', () => {
        it('should NOT crash elevateV1ParamsToV2Request when params are null', () => {
            const req: any = { params: null };
            expect(() => elevateV1ParamsToV2Request(req)).not.toThrow();
        });

        it('should NOT crash bridgeV2RequestToV1Params when params are null', () => {
            const req: any = { resId: '1' };
            expect(() => bridgeV2RequestToV1Params(req, null)).not.toThrow();
        });

        it('should handle undefined values gracefully in elevation', () => {
            const req: any = { params: { id: undefined, act: undefined } };
            elevateV1ParamsToV2Request(req);
            expect(req.resId).toBeUndefined();
            expect(req.act).toBeUndefined();
        });
    });
});
