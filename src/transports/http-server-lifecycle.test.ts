import { describe, it, expect, afterEach } from 'vitest';
import { HttpServerToolTransport } from './http-server';
import { RpcServerDispatcher } from './dispatcher';
import { findPort } from '@isdk/util';

describe('Transport V2: HTTP Server Lifecycle', () => {
   afterEach(() => {
      // 强制清理静态共享池
      (HttpServerToolTransport as any).sharedServers.clear();
   });

   it('should share physical server and shutdown only when last instance stops', async () => {
      const dispatcher = new RpcServerDispatcher();
      const port = await findPort(3001)

      // 创建两个共享相同端口 (3001) 的 Transport
      const t1 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${port}/api1` });
      const t2 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${port}/api2` });

      t1.addRpcHandler(`http://localhost:${port}/api1`);
      t2.addRpcHandler(`http://localhost:${port}/api2`);

      await t1.start();
      const addr = t1.getListenAddr();
      const binding = (HttpServerToolTransport as any).sharedServers.get(addr);

      expect(binding).toBeDefined();
      expect(binding.refCount).toBe(1);

      await t2.start();
      expect(binding.refCount).toBe(2);
      // t1 注册了 /api1/, t2 注册了 /api2/
      expect(binding.routes.size).toBe(2);

      // 停止第一个实例
      await t1.stop();
      expect(binding.refCount).toBe(1);
      expect(binding.routes.has('/api1/')).toBe(false);
      expect((HttpServerToolTransport as any).sharedServers.has(addr)).toBe(true); // 物理 Server 仍在

      // 停止最后一个实例
      await t2.stop();
      expect((HttpServerToolTransport as any).sharedServers.has(addr)).toBe(false); // 物理 Server 已关闭并移除
   });

   it('should handle defaultInstance handover safely', async () => {
      const dispatcher = new RpcServerDispatcher();
      const t1 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3002/api1' });
      const t2 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3002/api2' });

      t1.addRpcHandler('http://localhost:3002/api1');
      t2.addRpcHandler('http://localhost:3002/api2');

      await t1.start();
      await t2.start();

      const addr = t1.getListenAddr();
      const binding = (HttpServerToolTransport as any).sharedServers.get(addr);

      expect(binding.defaultInstance).toBe(t1); // 第一个实例启动时成为默认实例

      await t1.stop();
      // 停止 t1 后，默认实例应切换为仍然活跃的 t2
      expect(binding.defaultInstance).toBe(t2);

      await t2.stop();
      expect((HttpServerToolTransport as any).sharedServers.has(addr)).toBe(false);
   });
});
