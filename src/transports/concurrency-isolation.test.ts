import { describe, it, expect, beforeEach } from 'vitest';
import { RpcServerDispatcher } from './dispatcher';
import { RpcActiveTaskTracker } from './task-tracker';
import { ServerTools } from '../server-tools';
import { ToolRpcRequest } from './models';

describe('Transport V2: Concurrency Isolation', () => {
   let dispatcher: RpcServerDispatcher;
   
   /**
    * 一个模拟的单例工具，它模拟异步处理并返回它在 this.ctx 中看到的请求信息。
    * 如果框架不支持并发隔离（即错误地覆盖了单例的 this.ctx），
    * 那么先进入但后返回的请求将会看到后进入请求的上下文。
    */
   class MockSingletonTool extends ServerTools {
      async func(params: any) {
         const delay = params.delay || 0;
         if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
         }
         // 返回当前实例上下文中的 requestId
         return {
            requestId: this.ctx?.requestId,
         };
      }
   }

   const toolInstance = new MockSingletonTool('concurrencyTestTool');

   beforeEach(() => {
      const registry = {
         get: (id: string) => (id === 'concurrencyTestTool' ? toolInstance : undefined)
      };

      dispatcher = new RpcServerDispatcher({ 
         registry, 
         tracker: new RpcActiveTaskTracker(1000)
      });
   });

   it('should isolate this.ctx between concurrent requests to the same tool instance', async () => {
      const req1: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'concurrencyTestTool', requestId: 'REQ-1-LONG-TASK', 
         params: { delay: 50 }, headers: {}
      };
      const req2: ToolRpcRequest = {
         apiUrl: 'http://test', toolId: 'concurrencyTestTool', requestId: 'REQ-2-SHORT-TASK', 
         params: { delay: 10 }, headers: {}
      };

      // 并发执行：REQ-1 先进入但会 sleep 50ms，REQ-2 后进入但只 sleep 10ms
      const promise1 = dispatcher.dispatch(req1);
      const promise2 = dispatcher.dispatch(req2);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      // 验证隔离性：每个请求应当只看到属于自己的 requestId
      expect(res1.data.requestId).toBe('REQ-1-LONG-TASK');
      expect(res2.data.requestId).toBe('REQ-2-SHORT-TASK');
   });
});
