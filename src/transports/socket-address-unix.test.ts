import http from 'http';
import { unlinkSync } from 'fs';
import { describe, it, expect, afterEach } from 'vitest';
import { ServerToolTransport } from './server';
import { HttpServerToolTransport } from './http-server';
import { normalizeSocketAddress } from './socket-address';
import { RpcServerDispatcher } from './dispatcher';
import { RpcTransportManager } from './server-manager';
import { unixSocketPath, unixSocketUri } from './socket-address';
import { findPort } from '@isdk/util';

/** 无物理监听的 transport，用来验证审计不依赖具体实现。 */
class BareTransport extends ServerToolTransport {
  public addRpcHandler(apiUrl: string, options?: any): void {this.claimRoute(apiUrl, 'rpc', options);}
  public addDiscoveryHandler(apiUrl: string, handler: () => any, options?: any): void {
    this.claimRoute(apiUrl, 'discovery', { ...options, discoveryHandler: handler });
  }
  public async _start(): Promise<void> {}
  public async stop(): Promise<void> {}
  protected async toRpcRequest(): Promise<any> {return {};}
  protected async sendRpcResponse(): Promise<void> {}
}

/**
 * 只有一个地址概念：`getListenAddr()` —— 别人访问本服务用的地址。
 *
 * 对框架它是不透明字符串：Manager 只拿它当审计 map 的 key，不解析、不校验、
 * 不预测 bind 冲突。地址语义（host/port/socket、回环写法、监听之后补真实端口）
 * 归按 scheme 分派到的那个 transport 自己管，所以本文件里 HTTP 的部分测的是
 * HttpServerToolTransport 的覆写，基类部分只测「原样返回 apiUrl」。
 */
describe('ServerToolTransport address is opaque', () => {
  it('base returns apiUrl verbatim', () => {
    class Bare extends ServerToolTransport {
      public addRpcHandler(_apiUrl: string, _options?: any): void {}
      public addDiscoveryHandler(_apiUrl: string, _handler: () => any, _options?: any): void {}
      public async _start(): Promise<void> {}
      public async stop(): Promise<void> {}
      protected async toRpcRequest(): Promise<any> {return {};}
      protected async sendRpcResponse(): Promise<void> {}
    }
    const t = new Bare({ apiUrl: 'mem://bus-a/tools' });
    // 框架不裁 path、不补 scheme、不校验——它不是地址专家
    expect(t.getListenAddr()).toBe('mem://bus-a/tools');
    // 没有「绑定观测」这个第二概念：基类不暴露
    expect((t as any).getBoundAddress).toBeUndefined();
  });

  it('the audit key is whatever the transport reports, compared by equality', () => {
    const t = new BareTransport({ apiUrl: 'legacy://shared-1/tools' });
    const manager = new RpcTransportManager();
    manager.registerServer(t);
    expect((manager as any).routeOwnership.has('legacy://shared-1/tools')).toBe(true);
  });
});

describe('HttpServerToolTransport address', () => {
  afterEach(() => {
    (HttpServerToolTransport as any).sharedServers.clear();
  });

  it('is the canonical authority of apiUrl, stable across the start boundary', async () => {
    const dispatcher = new RpcServerDispatcher();
    const port = await findPort(3301);
    const t = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${port}/api` });
    t.addRpcHandler(`http://localhost:${port}/api`);

    const before = t.getListenAddr();
    expect(before).toBe(`http://localhost:${port}`);

    await t.start();
    // 声明的端口就是真实端口，地址不因 start 漂移
    expect(t.getListenAddr()).toBe(before);

    await t.stop();
    expect(t.getListenAddr()).toBe(before);
  });

  it('follows the kernel when port 0 asks it to pick', async () => {
    const dispatcher = new RpcServerDispatcher();
    const declared = await findPort(3302);
    const t = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${declared}/api` });
    t.addRpcHandler(`http://localhost:${declared}/api`);

    await t.start({ port: 0 });

    const addr = t.getListenAddr();
    const realPort = Number(addr.split(':').pop());
    // 地址必须是「能被别人访问」的那个：内核挑的端口，不是 apiUrl 里写死的
    expect(realPort).toBeGreaterThan(0);
    expect(realPort).not.toBe(declared);

    // 底座池 key 同步迁移，否则第二个按声明端口复用它的实例会以为已在服务
    const pool = (HttpServerToolTransport as any).sharedServers;
    expect(pool.has(addr)).toBe(true);
    expect(pool.has(`http://localhost:${declared}`)).toBe(false);

    await t.stop();
  });

  it('moves to the port and host declared at start()', async () => {
    const dispatcher = new RpcServerDispatcher();
    const stale = await findPort(3320);
    const used = await findPort(3321);
    const t = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${stale}/api` });
    t.addRpcHandler(`http://localhost:${stale}/api`);
    expect(t.getListenAddr()).toBe(`http://localhost:${stale}`);

    await t.start({ port: used, host: '127.0.0.1' });

    // apiUrl 里的端口已经过时：start 的参数才是真正声明的底座
    expect(t.getListenAddr()).toBe(`http://localhost:${used}`);
    await t.stop();
  });

  it('frees the port it gave up and still holds the one it took', async () => {
    const mgr = new RpcTransportManager();
    const stale = await findPort(3322);
    const used = await findPort(3323);
    const t1 = new HttpServerToolTransport({ apiUrl: `http://localhost:${stale}/api` });
    t1.addRpcHandler(`http://localhost:${stale}/api`);
    await t1.start({ port: used });
    mgr.registerServer(t1);

    // 旧端口上现在可以放别的 transport（地址不迁移就会误报冲突）
    const t2 = new HttpServerToolTransport({ apiUrl: `http://localhost:${stale}/v2` });
    t2.addRpcHandler(`http://localhost:${stale}/v2`);
    expect(() => mgr.registerServer(t2)).not.toThrow();

    // 真正占用的那个仍然必须被审计到
    const t3 = new HttpServerToolTransport({ apiUrl: `http://localhost:${used}/api` });
    t3.addRpcHandler(`http://localhost:${used}/api`);
    expect(() => mgr.registerServer(t3)).toThrow(/Routing Conflict/);

    await t1.stop();
  });

  it('gives a bare-path apiUrl a real base so two transports share one socket', async () => {
    const port = await findPort(3325);
    const a = new HttpServerToolTransport({ apiUrl: '/api' });
    a.addRpcHandler('/api');
    const b = new HttpServerToolTransport({ apiUrl: '/v2' });
    b.addRpcHandler('/v2');

    await a.start({ port });
    await b.start({ port });

    // 裸 path 只说了路由；底座由 bind 参数（+ 传输层确定的默认值）造出来
    expect(a.getListenAddr()).toBe(`http://*:${port}`);
    expect(b.getListenAddr()).toBe(`http://*:${port}`);
    const pool = (HttpServerToolTransport as any).sharedServers;
    expect(pool.size).toBe(1);
    expect(pool.get(`http://*:${port}`).refCount).toBe(2);

    await a.stop();
    await b.stop();
  });

  it('keeps the address put there by options preset on the transport', async () => {
    const port = await findPort(3326);
    const t = new HttpServerToolTransport({ apiUrl: `http://localhost:3327/api`, port });
    t.addRpcHandler(`http://localhost:3327/api`);
    await t.start();
    expect(t.getListenAddr()).toBe(`http://localhost:${port}`);
    await t.stop();
  });
});

describe('unix socket address', () => {
  // Node 不会在 close 时删除 socket 文件，所以每次跑用唯一路径
  const socketPath = (name: string) => `/tmp/tool-rpc-identity-${process.pid}-${Date.now()}-${name}.sock`;

  afterEach(() => {
    (HttpServerToolTransport as any).sharedServers.clear();
  });

  it('normalizes socket paths to one identity', () => {
    expect(unixSocketUri('/run/ai.sock')).toBe('unix:/run/ai.sock');
    expect(unixSocketUri('unix:/run/ai.sock')).toBe('unix:/run/ai.sock');
    expect(unixSocketUri('/run//ai.sock')).toBe('unix:/run/ai.sock');
    expect(unixSocketUri('/run/ai.sock/')).toBe('unix:/run/ai.sock');
    expect(unixSocketUri('/run/./ai.sock')).toBe('unix:/run/ai.sock');
    // 已经是别的 scheme（包括 Windows 盘符）不会被改写成 unix:
    expect(unixSocketUri('mem://bus-a')).toBe('mem://bus-a');
    expect(unixSocketUri('C:\\pipe\\ai')).toBe('C:\\pipe\\ai');
    // 走 URI 规范：先按段 percent-encode 再进 URI，要原值就 decode
    expect(unixSocketUri('/tmp/a b.sock')).toBe('unix:/tmp/a%20b.sock');
    expect(unixSocketUri('/tmp/套.sock')).toBe('unix:/tmp/%E5%A5%97.sock');
    expect(unixSocketUri('/tmp/a#b.sock')).toBe('unix:/tmp/a%23b.sock');
    expect(unixSocketUri('/var/../run/ai.sock')).toBe('unix:/run/ai.sock');
    // 取回来的路径要能直接 listen
    expect(unixSocketPath('unix:/tmp/a b.sock')).toBe('/tmp/a b.sock');
    expect(unixSocketPath('unix:/tmp/a%20b.sock')).toBe('/tmp/a b.sock');
    // 单射：`/tmp/a b.sock` 与 `/tmp/a%20b.sock` 是两个不同文件，canonical 必须不同
    // （塌了就误报冲突 / 复用错 socket）
    expect(unixSocketUri('/tmp/a b.sock')).not.toBe(unixSocketUri('/tmp/a%20b.sock'));
    expect(unixSocketUri('/tmp/套.sock')).not.toBe(unixSocketUri('/tmp/%E5%A5%97.sock'));
    // 往返可逆：包括字面 `%`（裸 `%` 不是合法转义序列，先编码成 `%25`）
    for (const p of ['/tmp/a b.sock', '/tmp/a%20b.sock', '/tmp/%.sock', '/tmp/%E5%A5%97.sock',
      '/tmp/a#b.sock', '/tmp/a?b.sock', '/tmp/套.sock', '/tmp/a=b&c.sock']) {
      expect(unixSocketPath(unixSocketUri(p))).toBe(p);
      // 幂等：canonical 形式再进一次不变（`unix:` 之后按已编码理解）
      expect(unixSocketUri(unixSocketUri(p))).toBe(unixSocketUri(p));
      expect(unixSocketUri(unixSocketPath(unixSocketUri(p))!)).toBe(unixSocketUri(p));
    }
    // `/` 与 `%2F` 可区分：`/` 只是分隔符，段内 `%2F` 是字面斜杠，不会被当分隔符
    expect(unixSocketUri('/tmp/a%2Fb.sock')).toBe('unix:/tmp/a%252Fb.sock');
    expect(unixSocketUri('unix:/tmp/a%2Fb.sock')).toBe('unix:/tmp/a%2Fb.sock');
    expect(unixSocketPath('unix:/tmp/a%2Fb.sock')).toBe('/tmp/a/b.sock');
    // HTTP transport 的归一对 unix 身份只做词法归一，不猜 host
    expect(normalizeSocketAddress('unix:/run//ai.sock')).toBe('unix:/run/ai.sock');
  });

  it('a socket listen declares the socket as its address and serves over it', async () => {
    const p = socketPath('serve');
    const t = new HttpServerToolTransport({ apiUrl: '/api' });
    t.addDiscoveryHandler('/api', () => ({ name: 'unix-transport' }));
    try {
      await t.start({ path: p });

      expect(t.getListenAddr()).toBe(unixSocketUri(p));

      const body = await new Promise<string>((resolve, reject) => {
        http.get({ socketPath: p, path: '/api/' }, res => {
          res.setEncoding('utf8');
          let data = '';
          res.on('data', chunk => {data += chunk;});
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      expect(JSON.parse(body)).toEqual({ name: 'unix-transport' });

      await t.stop();
      // stop 之后地址仍在：它是声明，不是一次性观测
      expect(t.getListenAddr()).toBe(unixSocketUri(p));
    } finally {
      try {unlinkSync(p);} catch { /* 不存在就算了 */ }
    }
  });

  it('audits two transports that declare the same socket', async () => {
    const mgr = new RpcTransportManager();
    const p = socketPath('audit');
    const other = socketPath('other');
    const t1 = new HttpServerToolTransport({ apiUrl: '/api' });
    t1.addRpcHandler('/api');
    try {
      await t1.start({ path: p });
      mgr.registerServer(t1);

      // 另一个 transport 报同一个地址：必须报冲突。
      // 地址对框架不透明，所以“同一个 socket”就是“同一个字符串”——
      // 自己拼个 `unix:<path>/api` 就与 HTTP 报的 canonical 形式不相等，
      // 那是 transport 的责任（覆写 getListenAddr），不是框架去解析修正。
      const t2 = new BareTransport({ apiUrl: unixSocketUri(p) });
      t2.addRpcHandler('/api');
      expect(() => mgr.registerServer(t2)).toThrow(/Routing Conflict/);

      // 不同 socket 就是不同底座，不能当冲突
      const t3 = new BareTransport({ apiUrl: unixSocketUri(other) });
      t3.addRpcHandler('/api');
      expect(() => mgr.registerServer(t3)).not.toThrow();

      await t1.stop();
    } finally {
      for (const f of [p, other]) {
        try {unlinkSync(f);} catch { /* 不存在就算了 */ }
      }
    }
  });
});

describe('normalizeSocketAddress (HTTP 自己的地址语义)', () => {
  it('drops the path and normalizes default ports', () => {
    expect(normalizeSocketAddress('http://localhost:3000/api/v1')).toBe('http://localhost:3000');
    expect(normalizeSocketAddress('HTTP://LocalHost:3000/A')).toBe('http://localhost:3000');
    expect(normalizeSocketAddress('http://example.com')).toBe('http://example.com');
    expect(normalizeSocketAddress('http://example.com:80')).toBe('http://example.com');
    expect(normalizeSocketAddress('https://example.com:443/v1')).toBe('https://example.com');
    expect(normalizeSocketAddress('http://localhost:3000/')).toBe('http://localhost:3000');
  });

  it('folds spellings of the same socket', () => {
    // 回环的几种写法是同一个 socket：不规范化就会各起一个 server，第二个 EADDRINUSE
    for (const u of ['http://127.0.0.1:3000', 'http://[::1]:3000', 'http://LOCALHOST:3000']) {
      expect(normalizeSocketAddress(u)).toBe('http://localhost:3000');
    }
    for (const u of ['http://0.0.0.0:3000', 'http://[::]:3000', 'http://*:3000']) {
      expect(normalizeSocketAddress(u)).toBe('http://*:3000');
    }
    // 绑定观测这种无 scheme 形式也进同一个 key 空间
    expect(normalizeSocketAddress('127.0.0.1:3000')).toBe('http://localhost:3000');
  });

  it('keeps userinfo and opaque URIs intact', () => {
    // userinfo 不是 host，不能丢
    expect(normalizeSocketAddress('mailbox://api@isdk.com/tools')).toBe('mailbox://api@isdk.com');
    // 裸 path 不是绝对 URL：它只说路由，底座由 transport 自己补
    expect(normalizeSocketAddress('/api')).toBe('/api');
  });

  it('does not predict bind conflicts', () => {
    // 通配不再「包含」具体 host：那是预测 EADDRINUSE，非传递所以会漏报，
    // 又把不同 host 同端口塌成一个底座（vhost 判死）。相等才复用，否则各自 listen。
    expect(normalizeSocketAddress('http://*:3000')).not.toBe(normalizeSocketAddress('http://localhost:3000'));
    expect(normalizeSocketAddress('http://10.0.0.1:3000')).not.toBe(normalizeSocketAddress('http://10.0.0.2:3000'));
    expect(normalizeSocketAddress('http://localhost:3000')).not.toBe(normalizeSocketAddress('http://localhost:3001'));
    expect(normalizeSocketAddress('http://localhost:3000')).not.toBe(normalizeSocketAddress('https://localhost:3000'));
  });
});
