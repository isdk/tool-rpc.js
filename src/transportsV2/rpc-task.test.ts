import { describe, it, expect } from 'vitest';
import { RpcActiveTaskTracker, ActiveTaskHandle } from './task-tracker';
import { RpcServerDispatcher } from './dispatcher';
import { RpcTaskResource } from './rpc-task';

describe('RpcTaskResource', () => {
   it('should be able to get status of an active task', async () => {
      const tracker = new RpcActiveTaskTracker(1000);
      const dispatcherId = new RpcServerDispatcher({ tracker });
      const api = new RpcTaskResource();
      
      const aborter = new AbortController();
      const handle = new ActiveTaskHandle('my-req', new Promise(() => {}), aborter, false, () => {});
      tracker.add('my-req', handle);

      // V2 规范：通过 context 传递路由信息 (使用 resId)
      const context = { resId: 'my-req', dispatcher: dispatcherId };
      
      try {
         api.get({}, context as any);
         expect.fail("Should throw 102");
      } catch (err: any) {
         expect(err.code).toBe(102);
         expect(err.message).toMatch(/Keep Polling/);
      }
      
      tracker.stop();
   });

   it('should be able to cancel an active task', async () => {
      const tracker = new RpcActiveTaskTracker(1000);
      const dispatcherId = new RpcServerDispatcher({ tracker });
      const api = new RpcTaskResource();
      
      const aborter = new AbortController();
      let cleaned = false;
      const handle = new ActiveTaskHandle('kill-me', new Promise(() => {}), aborter, false, () => {
         cleaned = true;
      });
      tracker.add('kill-me', handle);

      // 执行取消动作 ($cancel 映射自 RpcMethodsServerTool)
      api.$cancel({}, { resId: 'kill-me', dispatcher: dispatcherId } as any);

      expect(handle.status).toBe('aborted');
      expect(aborter.signal.aborted).toBe(true);
      expect(cleaned).toBe(true);
      
      tracker.stop();
   });

   it('should throw 404 if task is missing', async () => {
      const tracker = new RpcActiveTaskTracker(1000);
      const dispatcherId = new RpcServerDispatcher({ tracker });
      const api = new RpcTaskResource();
      
      try {
         api.get({}, { resId: 'ghost', dispatcher: dispatcherId } as any);
         expect.fail('Should throw 404');
      } catch (err: any) {
         expect(err.code).toBe(404);
         expect(err.message).toMatch(/Not Found/);
      }

      tracker.stop();
   });

   it('should return error status if task explicitly threw an exception', async () => {
      const tracker = new RpcActiveTaskTracker(1000);
      const dispatcherId = new RpcServerDispatcher({ tracker });
      const api = new RpcTaskResource();
      
      const aborter = new AbortController();
      const p = Promise.reject(new Error("My custom error"));
      p.catch(() => {}); // prevent unhandled rejection warning
      
      const handle = new ActiveTaskHandle('err-req', p, aborter, false, () => {});
      tracker.add('err-req', handle);
      
      // Allow microtask to run so the handle gets marked as error
      await new Promise(r => setTimeout(r, 0));

      try {
         api.get({}, { resId: 'err-req', dispatcher: dispatcherId } as any);
         expect.fail("Should throw 500");
      } catch (err: any) {
         expect(err.code).toBe(500);
         expect(err.message).toMatch(/My custom error/);
      }
      
      tracker.stop();
   });
});
