import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcTransportManager } from './manager';
import { HttpServerToolTransport } from './http-server';
import { RpcServerDispatcher } from './dispatcher';
import { RpcActiveTaskTracker, RpcActiveTaskHandle } from './task-tracker';
import { ServerTools } from '../server-tools';
import { ToolRpcRequest } from './models';
import http from 'http';

describe('Transport V2: Extreme Stress & Edge Cases', () => {
   let manager: RpcTransportManager;
   let dispatcher: RpcServerDispatcher;

   beforeEach(() => {
      // 必须先开启 Fake Timers，再创建 Tracker 实例
      vi.useFakeTimers();
      manager = new RpcTransportManager();
      // 使用较短的清理间隔，配合 FakeTimers 压测
      dispatcher = new RpcServerDispatcher({
         tracker: new RpcActiveTaskTracker(5000) // 5s TTL
      });
   });

   afterEach(async () => {
      await manager.stopAll();
      if (dispatcher?.tracker) {
         dispatcher.tracker.stop();
      }
      (HttpServerToolTransport as any).sharedServers.clear();
      vi.useRealTimers();
   });

   it('STRESS: 1000+ Concurrent Requests with Context Integrity', async () => {
      // Switch to real timers for this concurrency test as it relies on native Promise timing
      // and doesn't require precise timer control.
      vi.useRealTimers();

      /**
       * 验证：即使在极高并发下，由于影子实例机制，this.ctx 绝不会发生串号或丢失。
       */
      class HeavyTool extends ServerTools {
         async func(params: any) {
            // 模拟随机异步抖动，增加竞态发生的可能性
            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 15)));
            return { echo: this.ctx?.requestId };
         }
      }
      const tool = new HeavyTool('heavy');
      const registry = { get: () => tool };

      const count = 1000;
      const tasks = Array.from({ length: count }).map((_, i) => {
         const id = `STRESS-REQ-${i}`;
         const req: ToolRpcRequest = {
            apiUrl: 'http://test', toolId: 'heavy', requestId: id, params: {}, headers: {}
         };
         return dispatcher.dispatch(req, registry);
      });

      const results = await Promise.all(tasks);

      // 验证 100% 的准确率
      results.forEach((res, i) => {
         if (res.data.echo !== `STRESS-REQ-${i}`) {
            throw new Error(`CONCURRENCY LEAK: Request ${i} saw context of ${res.data.echo}`);
         }
      });
      expect(results.length).toBe(count);
   });

   it('STRESS: Rapid Server Start/Stop Oscillation', async () => {
      /**
       * 验证：物理端口的引用计数管理是否坚不可摧。
       * 如果计数逻辑有 Bug，高频波动会导致物理 Server 被提前关闭或无法关闭。
       */
      const addr = 'http://localhost:3006/api';
      const iterations = 100;
      const tasks = [];

      for (let i = 0; i < iterations; i++) {
         const t = new HttpServerToolTransport({ dispatcher, apiUrl: addr });
         t.addRpcHandler(addr);
         // 使用 force: true 强制关闭，防止在高频请求下连接挂起导致超时
         tasks.push(t.start().then(() => t.stop(true)));
      }

      await Promise.all(tasks);

      // 检查静态池是否完全归零
      expect((HttpServerToolTransport as any).sharedServers.size).toBe(0);
   }, 30000); // 增加本测试用例的超时时间为 30s

   it('STRESS: LPM Accuracy with Deep Nesting (10 Levels)', async () => {
      /**
       * 验证：最长前缀匹配算法在极端路径深度下的可靠性。
       */
      const port = 3007;
      const host = `http://localhost:${port}`;
      const levels = 10;
      const instances: HttpServerToolTransport[] = [];

      // 构建深度嵌套路由 /l0/l1/l2/l3...
      let currentPath = '/';
      for (let i = 0; i < levels; i++) {
         const path = currentPath + `l${i}/`;
         const t = new HttpServerToolTransport({ dispatcher, apiUrl: host + path });
         t.addRpcHandler(host + path);
         instances.push(t);
         currentPath = path;
      }

      // 乱序随机启动，增加算法复杂性
      const shuffled = [...instances].sort(() => Math.random() - 0.5);
      await Promise.all(shuffled.map(inst => inst.start()));

      const listenAddr = instances[0].getListenAddr() as string;

      for (let i = 0; i < levels; i++) {
         const targetPath = instances[i].getRoutes()[0] + 'action';
         const mockRes = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() } as any;
         const req = { url: targetPath, method: 'POST', headers: { host: 'localhost' } } as any;

         // 验证是否命中了正确的实例 (第 i 层应当由 instances[i] 处理)
         const spy = vi.spyOn(instances[i] as any, 'handleInternalRequest').mockImplementation(() => { });
         (HttpServerToolTransport as any).handleIncomingHttpRequest(listenAddr, req, mockRes);

         expect(spy, `LPM mismatch at level ${i} for path ${targetPath}`).toHaveBeenCalled();
         spy.mockRestore();
      }
   });

   it('STRESS: Tracker Memory & Sweep Pressure (5000 Tasks)', async () => {
      /**
       * 验证：账本在大规模任务注入和清理时的稳定性。
       */
      const taskCount = 5000;
      // 使用独立的 tracker，并给予足够长的 TTL (2m)，防止 60s 的模拟导致 processing 状态的任务过期
      const tracker = new RpcActiveTaskTracker(120000);

      // 注入 5000 个具有混合保留策略的任务
      for (let i = 0; i < taskCount; i++) {
         const aborter = new AbortController();
         const isLongRunning = i % 2 === 0;
         const promise = isLongRunning ? new Promise(() => { }) : Promise.resolve('ok');

         const handle = new RpcActiveTaskHandle(
            `STRESS-TASK-${i}`, promise, aborter, false, () => { },
            isLongRunning ? -1 : 0 // 一半 Permanent (-1), 一半 None (0)
         );
         tracker.add(`STRESS-TASK-${i}`, handle);
      }

      // 确保所有已 Resolve 的 Promise 回调执行完毕 (更新 status 为 'completed')
      await vi.runAllTicks();

      // 前进 60 秒触发一次扫除 (仅推进一次周期，避免 runAllTimers 的死循环)
      await vi.advanceTimersByTimeAsync(60000);

      let remainingCount = 0;
      for (let i = 0; i < taskCount; i++) {
         if (tracker.get(`STRESS-TASK-${i}`)) remainingCount++;
      }

      tracker.stop();
      // 预期：只有那一半 Permanent 模式的任务仍然存活
      expect(remainingCount).toBe(2500);
   });
});
