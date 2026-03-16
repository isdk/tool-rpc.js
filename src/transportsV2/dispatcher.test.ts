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

      dispatcher = new RpcServerDispatcher({ 
         registry, 
         tracker: new RpcActiveTaskTracker(1000),
         terminationGraceMs: 0
      });
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
      vi.advanceTimersByTime(60); // 50ms + 10ms buffer
      const res2 = await p2;

      expect(res2.status).toBe(RpcStatusCode.TERMINATED); // hard timeout kills task

      // 这里的断言现在应该成功了，因为 Dispatcher 在 catch 块中显式中止并清理了它
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

      registry.get = vi.fn().mockImplementation(() => ({
         run: () => new Promise(resolve => setTimeout(resolve, 100))
      }));

      const p = dispatcher.dispatch(req);
      vi.advanceTimersByTime(30); // 20ms + 10ms buffer
      const res = await p;

      expect(res.status).toBe(RpcStatusCode.TERMINATED);
      expect(dispatcher.tracker.get('req-global-timeout')).toBeUndefined();

      vi.useRealTimers();
   });

   it('should respect non-zero terminationGraceMs and delay 408 response', async () => {
      vi.useFakeTimers();
      dispatcher.terminationGraceMs = 500;
      dispatcher.globalTimeout = 50;

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'grace-req', params: {}, headers: {}
      };

      registry.get = vi.fn().mockImplementation(() => ({
         run: () => new Promise(resolve => setTimeout(() => resolve('done'), 2000))
      }));

      const p = dispatcher.dispatch(req);
      
      // 1. 超过硬超时时间 (50ms)，但未到宽限期 (500ms)
      vi.advanceTimersByTime(100);
      
      // 此时 Promise 应该仍处于 pending 状态
      let settled = false;
      p.finally(() => { settled = true; });
      await Promise.resolve(); // 刷新微任务队列
      expect(settled).toBe(false);

      // 2. 超过宽限期
      vi.advanceTimersByTime(500);
      const res = await p;

      expect(res.status).toBe(RpcStatusCode.TERMINATED);
      expect(settled).toBe(true);

      vi.useRealTimers();
   });

   it('should handle synchronous errors in tool execution', async () => {
      registry.get = vi.fn().mockReturnValue({
         run: () => { throw new Error('Sync Error'); }
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'syncTool', requestId: 'sync-req', params: {}, headers: {}
      };

      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(500);
      expect(res.error?.message).toBe('Sync Error');
   });

   it('should handle non-Error objects thrown by tool', async () => {
      registry.get = vi.fn().mockReturnValue({
         run: () => { throw "Primitive Error String"; }
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'stringTool', requestId: 'string-req', params: {}, headers: {}
      };

      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(500);
      expect(res.error?.message).toBe('Primitive Error String');
   });

   it('should call tool.cleanup when task is aborted', async () => {
      let cleanupCalled = false;
      const mockCleanup = vi.fn().mockImplementation(() => { cleanupCalled = true; });
      const mockRun = vi.fn().mockReturnValue(new Promise(() => { })); // Hangs

      registry.get = vi.fn().mockReturnValue({
         run: mockRun,
         cleanup: mockCleanup
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'cleanupTool', requestId: 'cleanup-req', params: { foo: 'bar' }, headers: {}
      };

      dispatcher.dispatch(req);
      const handle = dispatcher.tracker.get('cleanup-req');
      handle?.abort('Manual abort');

      expect(cleanupCalled).toBe(true);
      expect(mockCleanup).toHaveBeenCalledWith(
         expect.objectContaining({ foo: 'bar' }), 
         expect.objectContaining({ requestId: 'cleanup-req' })
      );
   });

   it('should be immediately visible in tracker once dispatched', async () => {
      const mockRun = vi.fn().mockReturnValue(new Promise(() => { })); // Hangs
      registry.get = vi.fn().mockReturnValue({ run: mockRun });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'immediate-id', params: {}, headers: {}
      };

      // We don't await because it hangs
      dispatcher.dispatch(req);

      const handle = dispatcher.tracker.get('immediate-id');
      expect(handle).toBeDefined();
      expect(handle?.status).toBe('processing');
   });

   it('should return 409 Conflict if requestId already exists in tracker', async () => {
      // 使用挂起的 Promise 以确保任务留在 tracker 中
      const mockRun = vi.fn().mockReturnValue(new Promise(() => { }));
      registry.get = vi.fn().mockReturnValue({ run: mockRun });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'testTool', requestId: 'duplicate-id', params: {}, headers: {}
      };

      // 1. 发起第一个请求 (不等待完成，因为它挂起了)
      dispatcher.dispatch(req);

      expect(dispatcher.tracker.get('duplicate-id')).toBeDefined();

      // 2. 发起第二个同 ID 请求，应该冲突
      const res = await dispatcher.dispatch(req);
      expect(res.status).toBe(RpcStatusCode.CONFLICT);
      expect(res.error?.message).toMatch(/already in use/);
   });

   it('should automatically provide built-in rpcTask resource and handle fetchCount', async () => {
      registry.get = vi.fn().mockImplementation(() => undefined);

      const req: ToolRpcRequest = {
         apiUrl: 'http://test',
         toolId: 'rpcTask',
         resId: 'some-task-id',
         requestId: 'req-system',
         params: {},
         headers: { [RPC_HEADERS.ACT]: 'get' }
      };

      const mockHandle = {
         fetchCount: 0,
         result: { foo: 'bar' },
         status: 'completed',
         touch: vi.fn(),
         shouldCleanup: vi.fn().mockReturnValue(false)
      };

      vi.spyOn(dispatcher.tracker, 'get').mockReturnValue(mockHandle as any);

      const res = await dispatcher.dispatch(req);

      expect(res.status).toBe(RpcStatusCode.OK);
      expect(res.data).toEqual({ foo: 'bar' });
      expect(mockHandle.fetchCount).toBe(1);
   });

   it('should pass context including headers, requestId, traceId, signal, and raw objects', async () => {
      const mockRun = vi.fn().mockImplementation((params, ctx) => {
         expect(ctx.signal).toBeInstanceOf(AbortSignal);
         expect(ctx.requestId).toBe('ctx-req-1');
         expect(ctx.req).toBe('mock-http-req');
         expect(ctx.reply).toBe('mock-http-res');
         return 'ok';
      });
      registry.get = vi.fn().mockReturnValue({ run: mockRun });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'contextTool', requestId: 'ctx-req-1',
         params: {}, headers: {},
         raw: { _req: 'mock-http-req', _res: 'mock-http-res' }
      };

      await dispatcher.dispatch(req);
      expect(mockRun).toHaveBeenCalled();
   });

   it('should allow overriding built-in system tools with user registry', async () => {
      // 在用户注册表中注册一个同名的 rpcTask
      const mockCustomRpcTask = vi.fn().mockResolvedValue('custom-system-tool');
      registry.get = vi.fn().mockImplementation((id: string) => {
         if (id === 'rpcTask') return { run: mockCustomRpcTask };
         return undefined;
      });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'rpcTask', requestId: 'override-req', params: {}, headers: {}
      };

      const res = await dispatcher.dispatch(req);
      expect(res.data).toBe('custom-system-tool');
      expect(mockCustomRpcTask).toHaveBeenCalled();
   });

   it('should use per-call registry when provided in dispatch()', async () => {
      const perCallTool = vi.fn().mockResolvedValue('per-call-ok');
      const perCallRegistry = { 
         get: (id: string) => (id === 'specialTool' ? { run: perCallTool } : undefined) 
      };

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'specialTool', requestId: 'per-call-req', params: {}, headers: {}
      };

      // 1. Without per-call registry (should fail)
      const res1 = await dispatcher.dispatch(req);
      expect(res1.status).toBe(RpcStatusCode.NOT_FOUND);

      // 2. With per-call registry (should succeed)
      const res2 = await dispatcher.dispatch(req, perCallRegistry);
      expect(res2.status).toBe(RpcStatusCode.OK);
      expect(res2.data).toBe('per-call-ok');
   });



   it('should trigger ctx.signal when task is aborted via tracker', async () => {
      let signalAborted = false;
      const mockRun = vi.fn().mockImplementation((params, ctx) => {
         ctx.signal.addEventListener('abort', () => { signalAborted = true; });
         return new Promise(() => { }); // hang
      });
      registry.get = vi.fn().mockReturnValue({ run: mockRun });

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'abortTool', requestId: 'abort-me', params: {}, headers: {}
      };

      // 1. Start task
      dispatcher.dispatch(req);

      // 2. Abort via tracker
      const handle = dispatcher.tracker.get('abort-me');
      expect(handle).toBeDefined();
      handle?.abort('System shutdown');

      expect(signalAborted).toBe(true);
      expect(handle?.status).toBe('aborted');
   });
});
