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
});
