import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RpcServerDispatcher } from './dispatcher';
import { RpcActiveTaskTracker } from './task-tracker';
import { ServerTools } from '../server-tools';
import { ToolRpcRequest, RpcStatusCode, RPC_HEADERS } from './models';

describe('RpcServerDispatcher', () => {
   let dispatcher: RpcServerDispatcher;
   let registry: typeof ServerTools;

   beforeEach(() => {
      registry = class MockTools extends ServerTools {
         static testTool = {
            run: vi.fn(),
            expectedDuration: 10000,
         };
         static longStreamTool = {
            stream: true,
            timeout: { keepAliveOnTimeout: true, value: 50 },
            run: () => new Promise(resolve => setTimeout(() => resolve('done'), 100)),
         };
         static timeoutTool = {
            timeout: 50,
            run: () => new Promise(resolve => setTimeout(() => resolve('done'), 100)),
         }
      } as unknown as typeof ServerTools;
      registry.get = vi.fn().mockImplementation((id: string) => (registry as any)[id]);

      dispatcher = new RpcServerDispatcher({ registry, tracker: new RpcActiveTaskTracker(1000) });
   });

   it('should reject when tool not found', async () => {
      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'noTool', requestId: '1', params: {}, headers: {}
      };
      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(RpcStatusCode.NOT_FOUND);
   });

   it('should execute tool and return OK', async () => {
      const mockRun = vi.fn().mockResolvedValue('success');
      registry.get = vi.fn().mockReturnValue({ run: mockRun });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: '1', params: { x: 1 }, headers: {}
      };

      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(RpcStatusCode.OK);
      expect(res.data).toBe('success');
      expect(mockRun).toHaveBeenCalledWith({ x: 1 }, expect.objectContaining({ requestId: '1' }));
   });

   it('should handle keepAlive (102 Processing) and timeout (408)', async () => {
      vi.useFakeTimers();

      const req1: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'longStreamTool', requestId: 'req-keepalive', params: {}, headers: {}
      };
      const p1 = dispatcher.dispatch(req1);
      vi.advanceTimersByTime(60); // passes the 50ms keepAlive timeout
      const res1 = await p1;

      expect(res1.status).toBe(RpcStatusCode.PROCESSING);   // keepAliveOnTimeout: true
      expect(res1.headers?.[RPC_HEADERS.RETRY_AFTER]).toBeGreaterThan(0);
      expect(dispatcher.tracker.get('req-keepalive')).toBeDefined(); // still in memory

      const req2: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'timeoutTool', requestId: 'req-timeout', params: {}, headers: {}
      };
      const p2 = dispatcher.dispatch(req2);
      vi.advanceTimersByTime(60); // passes the 50ms hard timeout
      const res2 = await p2;

      expect(res2.status).toBe(RpcStatusCode.TERMINATED); // hard timeout kills task
      expect(dispatcher.tracker.get('req-timeout')).toBeUndefined();

      vi.useRealTimers();
   });

   it('should reject when stream requested but tool does not support it', async () => {
      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'req-stream', params: { stream: true }, headers: {}
      };
      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(RpcStatusCode.BAD_REQUEST);
      expect(res.error?.message).toMatch(/Streaming not supported/);
   });

   it('should respect globalTimeout if tool timeout is not set', async () => {
      vi.useFakeTimers();
      dispatcher.globalTimeout = 20;

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'req-global-timeout', params: {}, headers: {}
      };

      // Override for this specific test
      registry.get = vi.fn().mockImplementation(() => ({
         run: () => new Promise(resolve => setTimeout(resolve, 100))
      }));

      const p = dispatcher.dispatch(req);
      vi.advanceTimersByTime(30);
      const res = await p;

      expect(res.status).toBe(RpcStatusCode.TERMINATED);
      expect(dispatcher.tracker.get('req-global-timeout')).toBeUndefined();

      vi.useRealTimers();
   });

   it('should respect client requested timeout from headers over globalTimeout', async () => {
      vi.useFakeTimers();
      dispatcher.globalTimeout = 100; // global is safe

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'req-client-timeout', params: {},
         headers: { [RPC_HEADERS.TIMEOUT]: '20' }
      };

      registry.get = vi.fn().mockImplementation(() => ({
         run: () => new Promise(resolve => setTimeout(resolve, 50))
      }));

      const p = dispatcher.dispatch(req);
      vi.advanceTimersByTime(30);
      const res = await p;

      // 20ms client timeout is less than 50ms run time, so it should terminate
      expect(res.status).toBe(RpcStatusCode.TERMINATED);
      expect(res.error?.message).toMatch(/timeout/is);

      vi.useRealTimers();
   });

   it('should automatically provide built-in rpcTask resource if not present in user registry', async () => {
      // Mock user registry without rpcTask
      registry.get = vi.fn().mockImplementation((id: string) => undefined);

      const req: ToolRpcRequest = {
         apiUrl: 'http://test',
         toolId: 'rpcTask',
         resId: 'some-task-id',
         act: 'get', // RpcTaskResource logic: use 'get' to retrieve status/result
         requestId: 'req-system',
         params: {},
         headers: { 'rpc-act': 'get' } // Simulate GET /api/rpcTask/:id
      };

      // We need a task in tracker to be found
      const mockHandle = {
          getStatus: () => ({ status: 'processing' }),
          result: { foo: 'bar' },
          status: 'completed'
      };
      dispatcher.tracker.get = vi.fn().mockReturnValue(mockHandle);

      const res = await dispatcher.dispatch(req);
      
      // Should find RpcTaskResource and execute get()
      expect(res.status).toBe(RpcStatusCode.OK);
      expect(res.data).toEqual({ foo: 'bar' });
   });

   it('should elevate params.id and params.act to context when compat.enableParamBridge is true', async () => {
      dispatcher.compat.enableParamBridge = true;
      const mockRun = vi.fn().mockResolvedValue('ok');
      registry.get = vi.fn().mockReturnValue({ run: mockRun });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'compat-req',
         params: { id: 'legacy-res-id', act: 'legacy-action', data: 1 },
         headers: {}
      };

      await dispatcher.dispatch(req);

      // Verify context received elevated values
      const context = mockRun.mock.calls[0][1];
      expect(context.resId).toBe('legacy-res-id');
      expect(context.act).toBe('legacy-action');
   });

   it('should handle non-Error objects thrown by tools', async () => {
      registry.get = vi.fn().mockReturnValue({
         run: () => { throw "String Error"; }
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'err-req', params: {}, headers: {}
      };

      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(500);
      expect(res.error?.message).toBe('String Error');
   });

   it('should handle thrown objects with status code', async () => {
      registry.get = vi.fn().mockReturnValue({
         run: () => { throw { status: 403, message: 'Forbidden' }; }
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'err-req-2', params: {}, headers: {}
      };

      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(403);
      expect(res.error?.message).toBe('Forbidden');
   });

   it('should pass context including headers, requestId, traceId, and signal', async () => {
      const mockRun = vi.fn().mockImplementation((params, ctx) => {
         return new Promise((resolve) => {
            expect(ctx.signal).toBeInstanceOf(AbortSignal);
            expect(ctx.signal.aborted).toBe(false);
            expect(ctx.requestId).toBe('ctx-req-1');
            expect(ctx.traceId).toBe('trace-xyz');
            expect(ctx.headers['x-custom']).toBe('foo');
            resolve('ok');
         });
      });
      registry.get = vi.fn().mockReturnValue({ run: mockRun });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'contextTool', requestId: 'ctx-req-1',
         traceId: 'trace-xyz',
         params: {},
         headers: { 'x-custom': 'foo' }
      };

      await dispatcher.dispatch(req);
      expect(mockRun).toHaveBeenCalled();
   });

   it('should trigger AbortSignal when timeout occurs', async () => {
      vi.useFakeTimers();
      const onAbort = vi.fn();
      
      registry.get = vi.fn().mockReturnValue({
         timeout: 50,
         run: (params: any, ctx: any) => {
            ctx.signal.addEventListener('abort', onAbort);
            return new Promise(() => {}); // hang forever
         }
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'abortTool', requestId: 'abort-req', params: {}, headers: {}
      };

      const p = dispatcher.dispatch(req);
      vi.advanceTimersByTime(60);
      try { await p; } catch {}

      expect(onAbort).toHaveBeenCalled();
      vi.useRealTimers();
   });

   it('should mark task as completed in tracker after background execution finishes', async () => {
      vi.useFakeTimers();
      
      // Setup a long running task that enters keepAlive
      registry.get = vi.fn().mockReturnValue({
         timeout: { value: 50, keepAliveOnTimeout: true },
         run: async () => {
            await new Promise(r => setTimeout(r, 100));
            return 'done';
         }
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'cleanupTool', requestId: 'clean-req', params: {}, headers: {}
      };

      // 1. Dispatch -> enters 102
      const p = dispatcher.dispatch(req);
      vi.advanceTimersByTime(60);
      const res102 = await p;
      expect(res102.status).toBe(102);
      expect(dispatcher.tracker.get('clean-req')).toBeDefined();

      // 2. Wait for task to complete (100ms total)
      vi.advanceTimersByTime(100); // Advance enough time
      
      // Flush microtasks multiple times to allow Promise chains to resolve
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      
      const handle = dispatcher.tracker.get('clean-req');
      expect(handle?.status).toBe('completed');
      expect(handle?.result).toBe('done');

      vi.useRealTimers();
   });
});
