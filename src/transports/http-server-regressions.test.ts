import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { Readable } from 'stream';
import { HttpServerToolTransport } from './http-server';
import { withReservedPort } from '../../test/helpers/ports';

/**
 * 代码审核（`http-server` / `http-client` / `mailbox-server` / `mailbox-client`）实测出的
 * 缺陷回归集：每条都先用探针复现（断言正确行为 → 当时必失败），修完再固化在这里。
 *
 * 全部走公开面（transport + 真实 HTTP 请求 + `getRaw()` 的监听观测），不依赖内部
 * helper 的名字，这样底下的池 / 规范化重构不会让这些用例失效。
 */

const stubDispatcher = (respond: (req: any) => any): any => ({
  dispatch: async (req: any) => respond(req),
});

describe('http-server review regressions', () => {
  afterEach(() => {
    (HttpServerToolTransport as any).sharedServers.clear();
  });

  it('R1 a vhost that merely contains "localhost" still binds the wildcard address', async () => {
    // 旧实现用 /localhost/i 扫地址串：`mylocalhost.example` 被当成回环，
    // 于是 listen 到 127.0.0.1，外部根本连不上（实测 server.address().address）
    const observed = await withReservedPort(4411, async (port) => {
      const t = new HttpServerToolTransport({ apiUrl: `http://mylocalhost.example:${port}/api` });
      t.addRpcHandler(`http://mylocalhost.example:${port}/api`);
      await t.start();
      const addr = (t.getRaw() as any)?.address();
      await t.stop();
      return addr;
    });

    expect(observed?.address).toBe('0.0.0.0');
  });

  it('R1b a loopback apiUrl still binds loopback, and an explicit bind wins', async () => {
    const observed = await withReservedPort(4421, async (port) => {
      const loopback = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/api` });
      loopback.addRpcHandler(`http://localhost:${port}/api`);
      await loopback.start();
      const loopAddr = (loopback.getRaw() as any)?.address();
      await loopback.stop();

      const explicit = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/api2` });
      explicit.addRpcHandler(`http://localhost:${port}/api2`);
      await explicit.start({ host: '0.0.0.0' });
      const explicitAddr = (explicit.getRaw() as any)?.address();
      await explicit.stop();

      return { loopAddr, explicitAddr };
    });

    expect(observed.loopAddr?.address).toBe('127.0.0.1');
    expect(observed.explicitAddr?.address).toBe('0.0.0.0');
  });

  it('R2 a route declared after start() is registered when start() runs again', async () => {
    const disp = (tag: string) => stubDispatcher((req: any) => ({ status: 200, data: `${tag}:${req.toolId}` }));

    const out = await withReservedPort(4431, async (port) => {
      const a = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/api`, dispatcher: disp('A') });
      a.addRpcHandler(`http://localhost:${port}/api`);
      await a.start();

      const b = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/v2`, dispatcher: disp('B') });
      b.addRpcHandler(`http://localhost:${port}/v2`);
      await b.start();

      // start 之后新增前缀，再 start 一次：旧实现的 isAttached 用 some()，
      // 「已有一个前缀在表上」就提前返回，/v3 进不了物理路由表 → 404
      b.addRpcHandler(`http://localhost:${port}/v3`);
      await b.start();

      const res = await fetch(`http://localhost:${port}/v3/tool1`);
      const body = await res.text();

      const binding = (HttpServerToolTransport as any).sharedServers.get(b.getListenAddr());
      const refCount = binding?.refCount;

      await b.stop();
      await a.stop();
      return { status: res.status, body, refCount };
    });

    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toBe('B:tool1');
    // 补登记新前缀不是第二次 attach：refCount 仍是 2（A + B），一次 stop 就能关掉底座
    expect(out.refCount).toBe(2);
  });

  it('R3 http.ServerOptions in the transport options reach http.createServer', async () => {
    // 类型上 `HttpServerToolTransportOptions extends http.ServerOptions`，
    // 但旧实现 createServer 一个都不转：maxHeaderSize: 64 照样收下 2KB 的请求头
    const status = await withReservedPort(4441, async (port) => {
      const t = new HttpServerToolTransport({
        apiUrl: `http://localhost:${port}/api`,
        maxHeaderSize: 64,
      });
      t.addRpcHandler(`http://localhost:${port}/api`);
      await t.start();
      const res = await fetch(`http://localhost:${port}/api/tool`, {
        method: 'POST', headers: { 'x-big': 'y'.repeat(2000) }, body: '{}',
      });
      await res.text();
      await t.stop();
      return res.status;
    });

    expect(status).toBe(431);
  });

  it('R4 a source stream that errors mid-response settles, and does not crash the process', async () => {
    const uncaught: any[] = [];
    const onUncaught = (err: any) => { uncaught.push(err); };
    process.on('uncaughtException', onUncaught);

    try {
      const outcome = await withReservedPort(4451, async (port) => {
        const dispatcher = stubDispatcher(() => {
          const src = new Readable({ read() {} });
          src.push('hello');
          setImmediate(() => src.emit('error', new Error('boom')));
          return { status: 200, data: src };
        });
        const t = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/api`, dispatcher });
        t.addRpcHandler(`http://localhost:${port}/api`);
        await t.start();

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 1500);
        let result = 'completed';
        try {
          const res = await fetch(`http://localhost:${port}/api/tool`, { signal: ac.signal });
          await res.text();
        } catch (err: any) {
          result = err.name === 'AbortError' ? 'hung' : `settled: ${err.message}`;
        }
        clearTimeout(timer);
        await t.stop();
        return result;
      });

      // 旧实现：pipe 不转发错误也不结束响应 → 客户端挂死到超时，
      // 且源流的 'error' 无人监听变成进程级未捕获异常
      expect(uncaught.map(e => e?.message)).toEqual([]);
      expect(outcome).not.toBe('hung');
      expect(outcome).toMatch(/^settled:/);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('R5 a POST body split across chunks keeps multibyte characters intact', async () => {
    const echoed = await withReservedPort(4461, async (port) => {
      const dispatcher = stubDispatcher((req: any) => ({ status: 200, data: req.params }));
      const t = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/api`, dispatcher });
      t.addRpcHandler(`http://localhost:${port}/api`);
      await t.start();

      const payload = Buffer.from(JSON.stringify({ text: '中文' }), 'utf8');
      const split = payload.indexOf(0xe4) + 1;   // 切在一个 3 字节字符中间

      const result = await new Promise<string>((resolve) => {
        const req = http.request(
          { port, method: 'POST', path: '/api/tool', headers: { 'content-type': 'application/json' } },
          (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve(`status=${res.statusCode} body=${text}`));
          },
        );
        req.write(payload.subarray(0, split));
        setTimeout(() => { req.write(payload.subarray(split)); req.end(); }, 80);
      });

      await t.stop();
      return result;
    });

    // 旧实现逐块 chunk.toString()：参数被静默换成 U+FFFD，状态码仍是 200
    expect(echoed).toBe('status=200 body={"text":"中文"}');
  });

  it('R6 an oversized body still gets a 413 and stops accumulating', async () => {
    const status = await withReservedPort(4471, async (port) => {
      const dispatcher = stubDispatcher(() => ({ status: 200, data: 'ok' }));
      const t = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/api`, dispatcher, maxBodySize: 1024 });
      t.addRpcHandler(`http://localhost:${port}/api`);
      await t.start();

      const res = await fetch(`http://localhost:${port}/api/tool`, {
        method: 'POST', body: 'a'.repeat(4096),
      });
      await res.text();
      await t.stop();
      return res.status;
    });

    expect(status).toBe(413);
  });
});
