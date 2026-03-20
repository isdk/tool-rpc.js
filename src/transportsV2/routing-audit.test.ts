import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcTransportManager } from './manager';
import { HttpServerToolTransport } from './http-server';
import { RpcServerDispatcher } from './dispatcher';
import http from 'http';

describe('Transport V2: Routing Audit & Prefix Matching', () => {
   let manager: RpcTransportManager;
   let dispatcher: RpcServerDispatcher;

   beforeEach(() => {
      manager = new RpcTransportManager();
      dispatcher = new RpcServerDispatcher();
   });

   afterEach(async () => {
      await manager.stopAll();
      (HttpServerToolTransport as any).sharedServers.clear();
   });

   it('should detect routing conflicts on the same physical address', async () => {
      const t1 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3003/api' });
      t1.addRpcHandler('http://localhost:3003/api');
      manager.addServer(t1);

      const t2 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3003/api' });
      t2.addRpcHandler('http://localhost:3003/api');

      // 预期：同一物理地址下重复注册相同路径应抛出冲突异常
      expect(() => manager.addServer(t2)).toThrow(/Routing Conflict/);
   });

   it('should allow different paths on the same physical address', async () => {
      const t1 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3004/api1' });
      t1.addRpcHandler('http://localhost:3004/api1');
      manager.addServer(t1);

      const t2 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3004/api2' });
      t2.addRpcHandler('http://localhost:3004/api2');

      // 预期成功：不同逻辑路径可以共用同一物理端口
      expect(() => manager.addServer(t2)).not.toThrow();
   });

   it('should correctly dispatch using Longest Prefix Match (LPM)', async () => {
      // 模拟两个具有嵌套关系的 Transport
      // T1 负责 /
      const t1 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3005/' });
      t1.addRpcHandler('http://localhost:3005/');
      
      // T2 负责更精确的 /api/v2/
      const t2 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3005/api/v2' });
      t2.addRpcHandler('http://localhost:3005/api/v2');

      // 绕过真实网络监听，仅测试分发逻辑
      await t1.start();
      await t2.start();

      const addr = t1.getListenAddr() as string;
      const mockRes = { 
         statusCode: 200, 
         setHeader: vi.fn(), 
         end: vi.fn() 
      } as unknown as http.ServerResponse;

      // 场景 A：请求 /api/v2/test
      // 应当命中 T2，因为 /api/v2/ (8 chars) 比 / (1 char) 更长
      const spyT2 = vi.spyOn(t2 as any, 'handleInternalRequest').mockImplementation(() => {});
      const reqA = { url: '/api/v2/test', method: 'POST', headers: { host: 'localhost' } } as http.IncomingMessage;
      
      (HttpServerToolTransport as any).handleIncomingHttpRequest(addr, reqA, mockRes);
      expect(spyT2).toHaveBeenCalled();

      // 场景 B：请求 /api/v1/test
      // 应当命中 T1，因为它不匹配 T2 的前缀，只能回退到根路径
      const spyT1 = vi.spyOn(t1 as any, 'handleInternalRequest').mockImplementation(() => {});
      const reqB = { url: '/api/v1/test', method: 'POST', headers: { host: 'localhost' } } as http.IncomingMessage;
      
      (HttpServerToolTransport as any).handleIncomingHttpRequest(addr, reqB, mockRes);
      expect(spyT1).toHaveBeenCalled();
   });
});
