import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcTransportManager } from './server-manager';
import { HttpServerToolTransport } from './http-server';
import { ServerToolTransport } from './server';
import { RpcServerDispatcher } from './dispatcher';
import http from 'http';
import { sleep } from '@isdk/util';
import { withReservedPort } from '../../test/helpers/ports';

/** 另一种 transport 类：只用基类的声明身份，不自己碰 host 归一。 */
class OtherKindTransport extends ServerToolTransport {
   public addRpcHandler(apiUrl: string): void {
      if (!this.apiUrl) {this.apiUrl = apiUrl;}
      this.claimRoute(apiUrl, 'rpc', {});
   }
   public addDiscoveryHandler(apiUrl: string, _handler: () => any, _options?: any): void {
      this.claimRoute(apiUrl, 'discovery', {});
   }
   public async _start(): Promise<void> {}
   public async stop(): Promise<void> {}
   protected async toRpcRequest(): Promise<any> {return {};}
   protected async sendRpcResponse(): Promise<void> {}
}

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

   it('detects a conflict across transport classes on one base', async () => {
      // 审计以前只在同类 transport 内生效：两边声明身份的形式不同（HTTP 是 host:port，
      // 基类是含 path 的 apiUrl），跳 transport 永远对不上 key。现在两边都是 canonical URI。
      const http1 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3310/api' });
      http1.addRpcHandler('http://localhost:3310/api');
      manager.addServer(http1);

      const other = new OtherKindTransport({ apiUrl: 'http://127.0.0.1:3310/api' });
      other.addRpcHandler('http://127.0.0.1:3310/api');

      expect(() => manager.addServer(other)).toThrow(/Routing Conflict/);
   });

   it('treats a wildcard listen as the same base as a specific host', async () => {
      // 实测：0.0.0.0:3000 与 localhost:3000 在两个方向上都 EADDRINUSE
      const wildcard = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://0.0.0.0:3311/api' });
      wildcard.addRpcHandler('http://0.0.0.0:3311/api');
      manager.addServer(wildcard);

      const specific = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3311/api' });
      specific.addRpcHandler('http://localhost:3311/api');

      expect(() => manager.addServer(specific)).toThrow(/Routing Conflict/);
      expect(() => manager.addServer(specific)).toThrow(/covers "http:\/\/localhost:3311"/);
   });

   it('treats two distinct non-loopback hosts as one base for HTTP (it binds 0.0.0.0)', async () => {
      // HTTP transport 对非回环 host 一律监听 0.0.0.0（实测：监听不属于本机的主机名会
      // EADDRNOTAVAIL），所以它占的底座就是 *:port，两个不同 host 同端口必撞。
      const a = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://10.0.0.1:3312/api' });
      a.addRpcHandler('http://10.0.0.1:3312/api');
      manager.addServer(a);

      const b = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://10.0.0.2:3312/api' });
      b.addRpcHandler('http://10.0.0.2:3312/api');

      expect(() => manager.addServer(b)).toThrow(/Routing Conflict/);
   });

   it('keeps two distinct specific hosts as distinct bases when the transport binds them', async () => {
      // 反向不能塌缩：Linux 上两个不同具体 host 同端口可共存
      const a = new OtherKindTransport({ apiUrl: 'http://10.0.0.1:3314/api' });
      a.addRpcHandler('http://10.0.0.1:3314/api');
      manager.addServer(a);

      const b = new OtherKindTransport({ apiUrl: 'http://10.0.0.2:3314/api' });
      b.addRpcHandler('http://10.0.0.2:3314/api');

      // 只注册一次：重复注册同一个实例本身就该报冲突
      expect(() => manager.addServer(b)).not.toThrow();
   });

   it('reuses a wildcard binding for a transport that declares a specific host', async () => {
      await sleep(100);

      // 两个实例要在 apiUrl 里写同一个端口，号码必须预先知道；用预留而非 findPort，
      // 被抢走时换号重跑。只有 wildcard 真的 listen，所以 factory 里只起它。
      let wildcard!: HttpServerToolTransport;
      let specific!: HttpServerToolTransport;
      const port = await withReservedPort(3313, async (p) => {
         wildcard = new HttpServerToolTransport({ dispatcher, apiUrl: `http://0.0.0.0:${p}/api1` });
         wildcard.addRpcHandler(`http://0.0.0.0:${p}/api1`);
         specific = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/api2` });
         specific.addRpcHandler(`http://localhost:${p}/api2`);
         await wildcard.start();
         return p;
      });

      // 具体 host 的实例挂到已有的通配底座上，不会再 listen 一次（否则必 EADDRINUSE）
      await specific.start();

      expect(specific.getRaw()).toBe(wildcard.getRaw());
      const pool = (HttpServerToolTransport as any).sharedServers;
      expect(pool.size).toBe(1);
      expect(pool.get(`http://*:${port}`).refCount).toBe(2);

      await specific.stop();
      await wildcard.stop();
   });

   it('should correctly dispatch using Longest Prefix Match (LPM)', async () => {
      // 模拟两个具有嵌套关系的 Transport
      // 这里必须预先拿到一个真实端口：两个 transport 要在 apiUrl 里写同一个 authority，
      // 才能落到同一个物理底座上做最长前缀匹配（port 0 会让两边各自听一个端口）。
      // 预先拿端口就有探测与 bind 之间的窗口，所以走预留：号码被抢走就换下一个重跑。
      await sleep(100)
      let t1!: HttpServerToolTransport
      let t2!: HttpServerToolTransport
      await withReservedPort(3316, async (p) => {
         // T1 负责 /
         t1 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/` });
         t1.addRpcHandler(`http://localhost:${p}/`);

         // T2 负责更精确的 /api/v2/
         t2 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/api/v2` });
         t2.addRpcHandler(`http://localhost:${p}/api/v2`);

         // 绕过真实网络监听，仅测试分发逻辑
         await t1.start();
         await t2.start();
         return p
      }, 'localhost')

      const addr = t1.getBaseUrl() as string;
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
