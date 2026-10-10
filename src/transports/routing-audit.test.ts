import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcTransportManager } from './server-manager';
import { HttpServerToolTransport } from './http-server';
import { ServerToolTransport } from './server';
import { normalizeSocketAddress } from './socket-address';
import { RpcServerDispatcher } from './dispatcher';
import http from 'http';
import { sleep } from '@isdk/util';
import { withReservedPort } from '../../test/helpers/ports';

/**
 * 另一种 transport 类。地址对框架不透明，所以插件要自己报——这里拿 HTTP 那套
 * 归一当例子，证明跳 transport 类的审计能对上 key；插件也可以报任何字符串，
 * 但报得与真实底座不一致就是插件自己的 bug，框架不会去解析修正。
 */
class OtherKindTransport extends ServerToolTransport {
   public getListenAddr(): string {return normalizeSocketAddress(this.apiUrl);}
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
      manager.registerServer(t1);

      const t2 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3003/api' });
      t2.addRpcHandler('http://localhost:3003/api');

      // 预期：同一物理地址下重复注册相同路径应抛出冲突异常
      expect(() => manager.registerServer(t2)).toThrow(/Routing Conflict/);
   });

   it('should allow different paths on the same physical address', async () => {
      const t1 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3004/api1' });
      t1.addRpcHandler('http://localhost:3004/api1');
      manager.registerServer(t1);

      const t2 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3004/api2' });
      t2.addRpcHandler('http://localhost:3004/api2');

      // 预期成功：不同逻辑路径可以共用同一物理端口
      expect(() => manager.registerServer(t2)).not.toThrow();
   });

   it('detects a conflict across transport classes on one base', async () => {
      // 跳 transport 类的审计能不能对上，取决于两边报的地址字符串是否相等：
      // 回环写法由 transport 自己规范化（HTTP 与上面的插件覆写都规范化）。
      const http1 = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3310/api' });
      http1.addRpcHandler('http://localhost:3310/api');
      manager.registerServer(http1);

      const other = new OtherKindTransport({ apiUrl: 'http://127.0.0.1:3310/api' });
      other.addRpcHandler('http://127.0.0.1:3310/api');

      expect(() => manager.registerServer(other)).toThrow(/Routing Conflict/);
   });

   it('does not pre-judge a wildcard listen against a specific host', async () => {
      // 以前这里会把 `0.0.0.0:3311` 当作“包含” `localhost:3311` 而报路由冲突。
      // 那是预测 bind 冲突：关系非传递（会漏报），又把 vhost 判死。
      // 现在 key 不相等就各自 listen，真撞了由内核报 EADDRINUSE。
      const wildcard = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://0.0.0.0:3311/api' });
      wildcard.addRpcHandler('http://0.0.0.0:3311/api');
      manager.registerServer(wildcard);

      const specific = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://localhost:3311/api' });
      specific.addRpcHandler('http://localhost:3311/api');

      expect(() => manager.registerServer(specific)).not.toThrow();

      await wildcard.start();
      await expect(specific.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
   });

   it('does not collapse two distinct non-loopback hosts onto one base', async () => {
      // 以前 HTTP 把非回环 host 塌成 `*:port`，两个不同 host 同端口直接报冲突，
      // vhost 就没法用。现在 key 就是声明的那个 authority，互不相干。
      const a = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://10.0.0.1:3312/api' });
      a.addRpcHandler('http://10.0.0.1:3312/api');
      manager.registerServer(a);

      const b = new HttpServerToolTransport({ dispatcher, apiUrl: 'http://10.0.0.2:3312/api' });
      b.addRpcHandler('http://10.0.0.2:3312/api');

      expect(() => manager.registerServer(b)).not.toThrow();
      expect(a.getListenAddr()).not.toBe(b.getListenAddr());
   });

   it('keeps two distinct specific hosts as distinct bases when the transport binds them', async () => {
      // 反向不能塌缩：Linux 上两个不同具体 host 同端口可共存
      const a = new OtherKindTransport({ apiUrl: 'http://10.0.0.1:3314/api' });
      a.addRpcHandler('http://10.0.0.1:3314/api');
      manager.registerServer(a);

      const b = new OtherKindTransport({ apiUrl: 'http://10.0.0.2:3314/api' });
      b.addRpcHandler('http://10.0.0.2:3314/api');

      // 只注册一次：重复注册同一个实例本身就该报冲突
      expect(() => manager.registerServer(b)).not.toThrow();
   });

   it('does not reuse a wildcard binding for a transport that declares a specific host', async () => {
      await sleep(100);

      // 底座复用只按地址字符串相等：`http://*:p` 与 `http://localhost:p` 不相等，
      // 所以不会复用——不会静默地“搭便车”，也不会静默地错过复用。
      // 两个写法在同一个端口上监听会怎样？内核回答。
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

      await expect(specific.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });

      const pool = (HttpServerToolTransport as any).sharedServers;
      expect(pool.size).toBe(1);
      expect(pool.get(`http://*:${port}`).refCount).toBe(1);

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
