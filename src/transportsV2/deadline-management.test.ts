import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RpcServerDispatcher } from './dispatcher';
import { RpcActiveTaskTracker } from './task-tracker';
import { ToolRpcRequest, RpcStatusCode } from './models';

describe('Transport V2: Deadline Management', () => {
   let dispatcher: RpcServerDispatcher;

   beforeEach(() => {
      dispatcher = new RpcServerDispatcher({ 
         tracker: new RpcActiveTaskTracker(1000)
      });
   });

   it('should eventually terminate a keepAlive task after global max execution time', async () => {
      vi.useFakeTimers();
      
      // 设置一个较短的全局最大执行时间进行测试
      (dispatcher as any).maxTaskRuntimeMs = 2000; // 2秒

      const registry = {
         get: () => ({
            stream: false,
            timeout: { value: 100, keepAliveOnTimeout: true },
            // 模拟一个永不返回的任务
            run: () => new Promise(() => {}) 
         })
      };

      const req: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'forever', requestId: 'req-background', 
         params: {}, headers: {}
      };

      // 1. 发起请求
      const p = dispatcher.dispatch(req, registry);
      
      // 2. 超过 100ms，应当返回 102
      await vi.advanceTimersByTimeAsync(150);
      const res = await p;
      expect(res.status).toBe(RpcStatusCode.PROCESSING);

      const handle = dispatcher.tracker.get('req-background');
      expect(handle).toBeDefined();
      expect(handle?.status).toBe('processing');

      // 3. 超过全局最大执行时间 (2000ms)
      await vi.advanceTimersByTimeAsync(2000);
      
      // 验证任务是否被自动中止了
      // 预期失败：目前代码没有后台死线监控
      expect(handle?.status).toBe('aborted');

      vi.useRealTimers();
   });
});
