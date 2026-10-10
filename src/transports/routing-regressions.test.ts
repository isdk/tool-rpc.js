import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'http';
import net from 'net';
import { HttpServerToolTransport } from './http-server';
import { ServerToolTransport } from './server';
import { RpcServerDispatcher } from './dispatcher';
import { RpcTransportManager } from './server-manager';
import { ToolRpcRequest } from './models';
import { withReservedPort } from '../../test/helpers/ports';

/**
 * 这两个 commit（claim route prefixes / canonical physical URI）留下的缺陷回归集。
 *
 * 断言的是**正确行为**，所以它们记录的是待修的行为契约，而不是当前实现。
 * 全部走公开面（transport + manager + 真实 HTTP 请求），不依赖内部 helper 的名字——
 * 这样底下的 identity / 规范化重构不会让这些测试失效。
 */

/** 无物理监听的 transport，只用来验证基类的路由声明与身份。 */
class Bare extends ServerToolTransport {
  public addRpcHandler(apiUrl: string, options?: any): void {
    if (!this.apiUrl) {this.apiUrl = apiUrl;}
    this.claimRoute(apiUrl, 'rpc', options);
  }
  public addDiscoveryHandler(apiUrl: string, handler: () => any, options?: any): void {
    this.claimRoute(apiUrl, 'discovery', { ...options, discoveryHandler: handler });
  }
  public async _start(): Promise<void> {}
  public async stop(): Promise<void> {}
  protected async toRpcRequest(): Promise<ToolRpcRequest> {return {} as ToolRpcRequest;}
  protected async sendRpcResponse(): Promise<void> {}
}

/** 把 dispatch 换成 200，于是「状态码」直接反映路由与规范化结果。 */
function stubDispatcher(captured: ToolRpcRequest[] = []): RpcServerDispatcher {
  const dispatcher = new RpcServerDispatcher();
  dispatcher.dispatch = (async (req: ToolRpcRequest) => {
    captured.push(req);
    return { status: 200, data: { ok: true } };
  }) as any;
  return dispatcher;
}

async function call(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number, body: any }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* 原样返回 */ }
  return { status: res.status, body };
}

/**
 * fetch 会先把 URL 规范化（`/../x` 发出去已是 `/x`），所以“越出根”这种
 * 只能看原始请求目标的情况必须走裸 socket。
 */
async function rawTarget(port: number, target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`POST ${target} HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}`);
    });
    let data = '';
    sock.on('data', chunk => {
      data += chunk;
      const head = data.split('\r\n')[0];
      if (data.includes('\r\n\r\n')) {
        sock.destroy();
        resolve(Number(head.split(' ')[1]));
      }
    });
    sock.on('error', reject);
  });
}

const pool = () => (HttpServerToolTransport as any).sharedServers as Map<string, any>;

describe('route claims: prefix derivation', () => {
  it('P1 derives the prefix from any absolute URL, not only http(s)', () => {
    const ws = new Bare();
    ws.addRpcHandler('ws://h:3000/api');
    expect(ws.getRoutes()).toEqual(['/api']);

    const mbox = new Bare();
    mbox.addRpcHandler('mailbox://srv.example/api/v2');
    expect(mbox.getRoutes()).toEqual(['/api/v2']);
  });

  it('P14 keeps /foo and /foo/ the same route by default', () => {
    const t = new Bare();
    t.addRpcHandler('/foo/');
    expect(t.getRoutes()).toEqual(['/foo']);
    const other = new Bare();
    other.addRpcHandler('/foo');
    expect(other.getRoutes()).toEqual(['/foo']);
  });
});

describe('identity: no bind prediction, but spelling-level canonicalization', () => {
  it('P2 a bare path apiUrl is not the same base as a unix socket of that name', () => {
    const mgr = new RpcTransportManager();
    const path = new Bare({ apiUrl: '/api' });
    path.addRpcHandler('/api');
    mgr.registerServer(path);

    const sock = new Bare({ apiUrl: 'unix:/api' });
    sock.addRpcHandler('/api');
    expect(() => mgr.registerServer(sock)).not.toThrow();
  });

  it('P3 does not pre-judge a clash between distinct hosts; the bind reports it', async () => {
    const mgr = new RpcTransportManager();
    let a!: HttpServerToolTransport;
    let b!: HttpServerToolTransport;

    const port = await withReservedPort(4101, (p) => {
      a = new HttpServerToolTransport({ apiUrl: `http://10.0.0.1:${p}/api` });
      a.addRpcHandler(`http://10.0.0.1:${p}/api`);
      b = new HttpServerToolTransport({ apiUrl: `http://10.0.0.2:${p}/api` });
      b.addRpcHandler(`http://10.0.0.2:${p}/api`);
      mgr.registerServer(a);
      mgr.registerServer(b);
      return p;
    });

    // 声明身份不同 → 审计不预判（预判非传递，会漏报也会误报）
    expect(port).toBeGreaterThan(0);
    await a.start();
    // 真实底座冲突由内核给出：两个 server 都监听 0.0.0.0:port
    await expect(b.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await a.stop();
  });

  it('keeps loopback spellings on one base (same socket, two spellings)', () => {
    // 把回环写法规范化是 HTTP transport 的事（基类只把地址当不透明字符串）。
    // 不规范化的话，`localhost` 与 `127.0.0.1` 会各起一个 server，第二个 EADDRINUSE。
    const mgr = new RpcTransportManager();
    const a = new HttpServerToolTransport({ apiUrl: 'http://localhost:4102/api' });
    a.addRpcHandler('http://localhost:4102/api');
    mgr.registerServer(a);

    const b = new HttpServerToolTransport({ apiUrl: 'http://127.0.0.1:4102/api' });
    b.addRpcHandler('http://127.0.0.1:4102/api');
    expect(b.getListenAddr()).toBe(a.getListenAddr());
    expect(() => mgr.registerServer(b)).toThrow(/Routing Conflict/);
  });

  it('P4 the audit key follows a bind declared after registerServer', async () => {
    const mgr = new RpcTransportManager();
    let stale!: number;
    let used!: number;
    let t!: HttpServerToolTransport;

    await withReservedPort(4103, async (p1) => withReservedPort(p1 + 1, async (p2) => {
      stale = p1;
      used = p2;
      t = new HttpServerToolTransport({ apiUrl: `http://localhost:${stale}/api` });
      t.addRpcHandler(`http://localhost:${stale}/api`);
      mgr.registerServer(t);
      await t.start({ port: used });
      return p2;
    }));

    expect(t.getListenAddr()).toBe(`http://localhost:${used}`);

    const late = new HttpServerToolTransport({ apiUrl: `http://localhost:${used}/api` });
    late.addRpcHandler(`http://localhost:${used}/api`);
    expect(() => mgr.registerServer(late)).toThrow(/Routing Conflict/);

    // 让出去的那个端口不再占位
    const freed = new HttpServerToolTransport({ apiUrl: `http://localhost:${stale}/api` });
    freed.addRpcHandler(`http://localhost:${stale}/api`);
    expect(() => mgr.registerServer(freed)).not.toThrow();

    await t.stop();
  });

  it('P12 stop() releases the audited routes', async () => {
    const mgr = new RpcTransportManager();
    const t = new HttpServerToolTransport({ apiUrl: 'http://localhost:4105/api' });
    t.addRpcHandler('http://localhost:4105/api');
    mgr.registerServer(t);
    await t.start();
    await t.stop();

    const next = new HttpServerToolTransport({ apiUrl: 'http://localhost:4105/api' });
    next.addRpcHandler('http://localhost:4105/api');
    expect(() => mgr.registerServer(next)).not.toThrow();
  });

  it('P15 cross-transport audit compares the reported address as a string', () => {
    // 地址对框架不透明：谁报什么就是什么。所以“同一个底座”取决于 transport
    // 自己报的字符串是否相等——HTTP 报 canonical authority，插件覆写 getListenAddr()
    // 就要报同一形式；框架不会去解析修正。
    class SameBase extends Bare {
      public getListenAddr(): string {return 'http://localhost:4106';}
    }
    const peer = new SameBase({ apiUrl: 'http://localhost:4106/api' });
    peer.addRpcHandler('http://localhost:4106/api');

    const mgr = new RpcTransportManager();
    const httpT = new HttpServerToolTransport({ apiUrl: 'http://127.0.0.1:4106/api' });
    httpT.addRpcHandler('http://127.0.0.1:4106/api');
    mgr.registerServer(httpT);
    expect(() => mgr.registerServer(peer)).toThrow(/Routing Conflict/);
  });
});

describe('shared base pool accounting', () => {
  afterEach(() => { pool().clear(); });

  it('P5 a repeated stop() does not close a base another instance still uses', async () => {
    const dispatcher = stubDispatcher();
    let t1!: HttpServerToolTransport;
    let t2!: HttpServerToolTransport;
    let port!: number;

    port = await withReservedPort(4110, async (p) => {
      t1 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/a` });
      t1.addRpcHandler(`http://localhost:${p}/a`);
      t2 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/b` });
      t2.addRpcHandler(`http://localhost:${p}/b`);
      await t1.start();
      await t2.start();
      return p;
    });

    await t2.stop();
    await t2.stop();

    expect((await call(port, '/a/tool')).status).toBe(200);
    await t1.stop();
    expect(pool().size).toBe(0);
  });

  it('P6 a repeated start() is idempotent', async () => {
    const dispatcher = stubDispatcher();
    let t!: HttpServerToolTransport;
    let port!: number;

    port = await withReservedPort(4112, async (p) => {
      t = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/a` });
      t.addRpcHandler(`http://localhost:${p}/a`);
      await t.start();
      await t.start();
      return p;
    });

    expect(pool().get(`http://localhost:${port}`).refCount).toBe(1);
    await t.stop();
    expect(pool().size).toBe(0);
  });

  it('P7 claiming a prefix already owned on the same base fails instead of stealing it', async () => {
    const dispatcher = stubDispatcher();
    let t1!: HttpServerToolTransport;
    let t2!: HttpServerToolTransport;
    let port!: number;

    port = await withReservedPort(4114, async (p) => {
      t1 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/api` });
      t1.addRpcHandler(`http://localhost:${p}/api`);
      t2 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/api` });
      t2.addRpcHandler(`http://localhost:${p}/api`);
      await t1.start();
      return p;
    });

    await expect(t2.start()).rejects.toThrow(/already claimed|Routing Conflict/);
    expect(pool().get(`http://localhost:${port}`).routes.get('/api/')).toBe(t1);
    await t1.stop();
  });

  it('P18 stopping one instance keeps the other instance routes intact', async () => {
    const dispatcher = stubDispatcher();
    let t1!: HttpServerToolTransport;
    let t2!: HttpServerToolTransport;
    let port!: number;

    port = await withReservedPort(4116, async (p) => {
      t1 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/a` });
      t1.addRpcHandler(`http://localhost:${p}/a`);
      t2 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/b` });
      t2.addRpcHandler(`http://localhost:${p}/b`);
      await t1.start();
      await t2.start();
      return p;
    });

    await t2.stop();
    expect((await call(port, '/a/tool')).status).toBe(200);
    await t1.stop();
  });

  it('P16 a kernel-picked port is not advertised as the apiUrl base', async () => {
    const dispatcher = stubDispatcher();
    let t1!: HttpServerToolTransport;
    let t2!: HttpServerToolTransport;
    let port!: number;

    port = await withReservedPort(4118, async (p) => {
      t1 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${p}/a` });
      t1.addRpcHandler(`http://localhost:${p}/a`);
      await t1.start({ port: 0 });
      return p;
    });

    // t1 实际听的是内核挑的端口，port 上并没有人占着
    t2 = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${port}/b` });
    t2.addRpcHandler(`http://localhost:${port}/b`);
    await t2.start();

    expect((await call(port, '/b/tool')).status).toBe(200);
    await t2.stop();
    await t1.stop();
  });

  it('P13 a request that reaches a base with no binding gets 503, not a hung socket', () => {
    const res: any = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    (HttpServerToolTransport as any).handleIncomingHttpRequest('http://localhost:4119', { url: '/x', method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.end).toHaveBeenCalled();
  });
});

describe('path normalization on the request path', () => {
  afterEach(() => { pool().clear(); });

  /** 起一个 /api 的 transport，返回端口。 */
  async function serve(apiUrl: string, from: number, captured: ToolRpcRequest[] = []): Promise<{ port: number, t: HttpServerToolTransport }> {
    let t!: HttpServerToolTransport;
    let port!: number;
    port = await withReservedPort(from, async (p) => {
      t = new HttpServerToolTransport({ dispatcher: stubDispatcher(captured), apiUrl });
      t.addRpcHandler(apiUrl);
      await t.start();
      return p;
    });
    return { port, t };
  }

  it('P8 collapses // the same way on both sides of the match', async () => {
    const { port, t } = await serve('http://localhost:4121/a//b', 4121);
    expect(t.getRoutes()).toEqual(['/a/b']);
    expect((await call(port, '/a//b/tool')).status).toBe(200);
    expect((await call(port, '/a/b/tool')).status).toBe(200);
    await t.stop();
  });

  it('P9 resolves dot segments, and answers 400 when one escapes the root', async () => {
    const captured: ToolRpcRequest[] = [];
    const { port, t } = await serve('http://localhost:4123/api', 4123, captured);

    // 解析掉 dot 段，于是本路由器和任何规范化代理看到的是同一个路径
    await call(port, '/api/x/../y');
    await call(port, '/api/./z');
    expect(captured[0].toolId).toBe('y');
    expect(captured[1].toolId).toBe('z');

    // dot 段解析掉：本路由器与任何规范化代理看到的是同一个路径。
    // `/api/../x` 解析成 `/x`，那里没有路由 → 404（不是静默变成另一个 transport 的路由）
    expect((await call(port, '/api/../x')).status).toBe(404);
    expect((await call(port, '/api/%2e%2e/x')).status).toBe(404);
    // 只有越出根才 400（fetch 会先规范化，所以走裸 socket）
    expect(await rawTarget(port, '/../x')).toBe(400);
    expect(await rawTarget(port, '/%2e%2e/x')).toBe(400);
    await t.stop();
  });

  it('P10 keeps %2F as a literal segment character and answers 400 for a bad escape', async () => {
    const captured: ToolRpcRequest[] = [];
    const { port, t } = await serve('http://localhost:4125/api', 4125, captured);

    await call(port, '/api/a%2Fb');
    await call(port, '/api/a/b');
    expect(captured[0].toolId).toBe('a%2Fb');
    expect(captured[0].resId).toBeUndefined();
    expect(captured[1].toolId).toBe('a');
    expect(captured[1].resId).toBe('b');

    expect((await call(port, '/api/%ZZ')).status).toBe(400);
    await t.stop();
  });

  it('decodes ordinary escapes per segment without folding case', async () => {
    const captured: ToolRpcRequest[] = [];
    const { port, t } = await serve('http://localhost:4127/api', 4127, captured);

    await call(port, '/api/a%20b');
    expect(captured[0].toolId).toBe('a b');

    await call(port, '/api/Tool');
    expect(captured[1].toolId).toBe('Tool');
    await t.stop();
  });

  it('P11 canonicalizes the Host header before it becomes apiUrl / hits the SSRF check', async () => {
    const mgr = new RpcTransportManager();
    mgr.addRestrictedPattern('localhost');
    const captured: ToolRpcRequest[] = [];
    const t = new HttpServerToolTransport({ dispatcher: stubDispatcher(captured), apiUrl: '' });
    (t as any).manager = mgr;

    for (const host of ['LocalHost', 'LOCALHOST', 'localhost.', 'LocalHost:80']) {
      const req = { url: '/api/tool', method: 'GET', headers: { host } } as unknown as http.IncomingMessage;
      const rpc = await (t as any).toRpcRequest(req);
      captured.length = 0;
      let blocked = false;
      try { mgr.validateRpcRequest(rpc); } catch { blocked = true; }
      expect(blocked, `Host: ${host} must not bypass the restricted pattern`).toBe(true);
    }
  });
});
