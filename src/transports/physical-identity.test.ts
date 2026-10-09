import http from 'http';
import { unlinkSync } from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServerToolTransport } from './server';
import { HttpServerToolTransport } from './http-server';
import { RpcServerDispatcher } from './dispatcher';
import { RpcTransportManager } from './server-manager';
import { canonicalPhysicalUri, samePhysicalBase, unixSocketPath, unixSocketUri } from './physical-uri';
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
 * 三个职能必须各归其位：
 *  - getBaseUrl()      声明身份：构造期即可得，start 前后不变，是审计 / 池 / 分发的 key
 *  - getBoundAddress() 实际绑定观测：仅 start 后可得，只用于日志与 port 0 补全
 *  - getListenAddr()   已废弃别名，必须与声明身份同值，且每实例只警告一次
 */
describe('Physical identity: declared vs observed', () => {
  afterEach(() => {
    (HttpServerToolTransport as any).sharedServers.clear();
  });

  it('base class declares apiUrl as its identity and reports no bound address', () => {
    class Bare extends ServerToolTransport {
      public async _start(): Promise<void> {}
      public async stop(): Promise<void> {}
      protected async toRpcRequest(): Promise<any> {return {};}
      protected async sendRpcResponse(): Promise<void> {}
    }
    const t = new Bare({ apiUrl: 'mem://bus-a/tools' });
    // 物理底座只到 authority，path 不属于它
    expect(t.getBaseUrl()).toBe('mem://bus-a');
    expect(t.getBoundAddress()).toBeUndefined();
  });

  it('HTTP declared identity is stable across the start boundary', async () => {
    const dispatcher = new RpcServerDispatcher();
    const port = await findPort(3301);
    const t = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${port}/api` });
    t.addRpcHandler(`http://localhost:${port}/api`);

    const before = t.getBaseUrl();
    expect(before).toBe(`http://localhost:${port}`);
    // 未监听时没有绑定观测可言
    expect(t.getBoundAddress()).toBeUndefined();

    await t.start();

    // 审计 key 不得因为 start 而漂移
    expect(t.getBaseUrl()).toBe(before);
    // 绑定观测是真实 socket 的值，与声明身份不是同一个字符串空间
    expect(t.getBoundAddress()).toBe(`127.0.0.1:${port}`);

    await t.stop();
    // 停止后池条目已移除，观测随之消失，声明身份仍在
    expect(t.getBoundAddress()).toBeUndefined();
    expect(t.getBaseUrl()).toBe(before);
  });

  it('port 0 keeps the declared identity while the observed bind reports the real port', async () => {
    const dispatcher = new RpcServerDispatcher();
    const port = await findPort(3302);
    const t = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${port}/api` });
    t.addRpcHandler(`http://localhost:${port}/api`);

    await t.start({ port: 0 });

    expect(t.getBaseUrl()).toBe(`http://localhost:${port}`);
    const bound = t.getBoundAddress()!;
    const boundPort = Number(bound.split(':').pop());
    expect(boundPort).toBeGreaterThan(0);
    expect(boundPort).not.toBe(port);

    await t.stop();
  });

  it('deprecated getListenAddr mirrors the declared identity and warns once per instance', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const t = new HttpServerToolTransport({ apiUrl: 'http://localhost:3303/api' });
      expect(t.getListenAddr()).toBe(t.getBaseUrl());
      t.getListenAddr();
      t.getListenAddr();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/getListenAddr\(\) is deprecated/);

      // 另一个实例仍会警告一次（警告是每实例的，不是进程级的）
      const other = new HttpServerToolTransport({ apiUrl: 'http://localhost:3304/api' });
      other.getListenAddr();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('a third-party subclass that only overrides getListenAddr still drives the audit key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      class LegacyTransport extends ServerToolTransport {
        public getListenAddr(): string {return 'legacy://shared-1';}
        public async _start(): Promise<void> {}
        public async stop(): Promise<void> {}
        protected async toRpcRequest(): Promise<any> {return {};}
        protected async sendRpcResponse(): Promise<void> {}
      }

      const t = new LegacyTransport({ apiUrl: 'legacy://shared-1/tools' });
      // 升级后池 key / 审计 key 不得从旧覆写漂移
      expect(t.getBaseUrl()).toBe('legacy://shared-1');
      // 覆写了旧名就不该再触发废弃警告（那是用户自己的实现）
      expect(warn).not.toHaveBeenCalled();

      const manager = new RpcTransportManager();
      manager.addServer(t);
      expect((manager as any).routeAudit.has('legacy://shared-1')).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not recurse when a legacy override delegates to super.getListenAddr()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      class LegacySuper extends ServerToolTransport {
        public getListenAddr(): string {return `legacy-super:${super.getListenAddr()}`;}
        public async _start(): Promise<void> {}
        public async stop(): Promise<void> {}
        protected async toRpcRequest(): Promise<any> {return {};}
        protected async sendRpcResponse(): Promise<void> {}
      }

      const t = new LegacySuper({ apiUrl: 'legacy://delegating' });
      // 护栏必须让 super 那一跳落到基类默认值，而不是回到 getBaseUrl() 再转一圈
      expect(t.getBaseUrl()).toBe('legacy-super:legacy://delegating');
      expect(t.getBaseUrl()).toBe('legacy-super:legacy://delegating');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Declared bind options are part of the declared identity', () => {
  afterEach(() => {
    (HttpServerToolTransport as any).sharedServers.clear();
  });

  it('moves the identity to the port and host declared at start()', async () => {
    const dispatcher = new RpcServerDispatcher();
    const stale = await findPort(3320);
    const used = await findPort(3321);
    const t = new HttpServerToolTransport({ dispatcher, apiUrl: `http://localhost:${stale}/api` });
    t.addRpcHandler(`http://localhost:${stale}/api`);
    expect(t.getBaseUrl()).toBe(`http://localhost:${stale}`);

    await t.start({ port: used, host: '127.0.0.1' });

    // apiUrl 里的端口已经过时：start 的参数才是真正声明的底座
    expect(t.getBaseUrl()).toBe(`http://localhost:${used}`);
    expect(t.getBoundAddress()).toBe(`127.0.0.1:${used}`);
    await t.stop();
  });

  it('frees the port it gave up and still holds the one it took', async () => {
    const mgr = new RpcTransportManager();
    const stale = await findPort(3322);
    const used = await findPort(3323);
    const t1 = new HttpServerToolTransport({ apiUrl: `http://localhost:${stale}/api` });
    t1.addRpcHandler(`http://localhost:${stale}/api`);
    await t1.start({ port: used });
    mgr.addServer(t1);

    // 旧端口上现在可以放别的 transport（不改写就会误报冲突）
    const t2 = new HttpServerToolTransport({ apiUrl: `http://localhost:${stale}/v2` });
    t2.addRpcHandler(`http://localhost:${stale}/v2`);
    expect(() => mgr.addServer(t2)).not.toThrow();

    // 真正占用的那个仍然必须被审计到
    const t3 = new HttpServerToolTransport({ apiUrl: `http://localhost:${used}/api` });
    t3.addRpcHandler(`http://localhost:${used}/api`);
    expect(() => mgr.addServer(t3)).toThrow(/Routing Conflict/);

    await t1.stop();
  });

  it('an explicit wildcard host widens the identity to *', async () => {
    const port = await findPort(3324);
    const t = new HttpServerToolTransport({ apiUrl: `http://localhost:${port}/api` });
    t.addRpcHandler(`http://localhost:${port}/api`);
    await t.start({ port, host: '0.0.0.0' });
    expect(t.getBaseUrl()).toBe(`http://*:${port}`);
    await t.stop();
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
    expect(a.getBaseUrl()).toBe(`http://*:${port}`);
    expect(b.getBaseUrl()).toBe(`http://*:${port}`);
    const pool = (HttpServerToolTransport as any).sharedServers;
    expect(pool.size).toBe(1);
    expect(pool.get(`http://*:${port}`).refCount).toBe(2);

    await a.stop();
    await b.stop();
  });

  it('keeps the identity put there by options preset on the transport', async () => {
    const port = await findPort(3326);
    // 预置在 options 里的 port 也是声明，不只是 start 入参
    const t = new HttpServerToolTransport({ apiUrl: `http://localhost:3327/api`, port });
    t.addRpcHandler(`http://localhost:3327/api`);
    await t.start();
    expect(t.getBaseUrl()).toBe(`http://localhost:${port}`);
    await t.stop();
  });
});

describe('unix socket identity', () => {
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
    expect(unixSocketUri('/tmp/a b.sock')).toBe('unix:/tmp/a%20b.sock');
    expect(unixSocketUri('/tmp/a%20b.sock')).toBe('unix:/tmp/a%2520b.sock');
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
    // apiUrl 形式也走同一套归一
    expect(canonicalPhysicalUri('unix:/run//ai.sock/api')).toBe('unix:/run/ai.sock/api');
    expect(canonicalPhysicalUri('unix:/tmp/a b.sock')).toBe('unix:/tmp/a%20b.sock');
    expect(samePhysicalBase('unix:/run/ai.sock/', 'unix:/run//ai.sock')).toBe(true);
    // 同一个 socket 的两种写法（已编码 / 未编码）归一到同一底座
    expect(samePhysicalBase('unix:/tmp/a b.sock', 'unix:/tmp/a%20b.sock')).toBe(true);
    expect(samePhysicalBase('unix:/run/ai.sock', 'unix:/run/other.sock')).toBe(false);
  });

  it('a socket listen declares the socket as its base and serves over it', async () => {
    const p = socketPath('serve');
    const t = new HttpServerToolTransport({ apiUrl: '/api' });
    t.addDiscoveryHandler('/api', () => ({ name: 'unix-transport' }));
    try {
      await t.start({ path: p });

      expect(t.getBaseUrl()).toBe(unixSocketUri(p));
      expect(t.getBoundAddress()).toBe(unixSocketUri(p));

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
      expect(t.getBoundAddress()).toBeUndefined();
      // 声明身份不随 stop 消失：审计 key 仍然可用
      expect(t.getBaseUrl()).toBe(unixSocketUri(p));
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
      mgr.addServer(t1);

      // 另一个 transport 实现声明同一个 socket：必须报冲突
      const t2 = new BareTransport({ apiUrl: `unix:${p}` });
      t2.addRpcHandler('/api');
      expect(t2.getBaseUrl()).toBe(unixSocketUri(p));
      expect(() => mgr.addServer(t2)).toThrow(/Routing Conflict/);

      // 不同 socket 就是不同底座，不能当冲突
      const t3 = new BareTransport({ apiUrl: `unix:${other}` });
      t3.addRpcHandler('/api');
      expect(() => mgr.addServer(t3)).not.toThrow();

      await t1.stop();
    } finally {
      for (const f of [p, other]) {
        try {unlinkSync(f);} catch { /* 不存在就算了 */ }
      }
    }
  });
});

describe('canonicalPhysicalUri / samePhysicalBase', () => {
  it('drops the path and normalizes default ports', () => {
    expect(canonicalPhysicalUri('http://localhost:3000/api/v1')).toBe('http://localhost:3000');
    expect(canonicalPhysicalUri('HTTP://LocalHost:3000/A')).toBe('http://localhost:3000');
    // URL 自己丢弃默认端口：两种写法归一到同一个 key
    expect(canonicalPhysicalUri('http://example.com')).toBe('http://example.com');
    expect(canonicalPhysicalUri('http://example.com:80')).toBe('http://example.com');
    expect(canonicalPhysicalUri('https://example.com:443/v1')).toBe('https://example.com');
    // special scheme 的 URL 会把 path 补成 '/'，不能让它变成两个 key
    expect(canonicalPhysicalUri('http://localhost:3000/')).toBe('http://localhost:3000');
    // 比较时再按 http→80 / https→443 补齐
    expect(samePhysicalBase('http://example.com', 'http://example.com:80')).toBe(true);
  });

  it('normalizes loopback aliases and wildcard hosts', () => {
    for (const u of ['http://127.0.0.1:3000', 'http://[::1]:3000', 'http://LOCALHOST:3000']) {
      expect(canonicalPhysicalUri(u)).toBe('http://localhost:3000');
    }
    for (const u of ['http://0.0.0.0:3000', 'http://[::]:3000']) {
      expect(canonicalPhysicalUri(u)).toBe('http://*:3000');
    }
  });

  it('keeps userinfo and opaque URIs intact', () => {
    // userinfo 不是 host，不能丢
    expect(canonicalPhysicalUri('mailbox://api@isdk.com/tools')).toBe('mailbox://api@isdk.com');
    expect(canonicalPhysicalUri('unix:/run/ai.sock')).toBe('unix:/run/ai.sock');
    // 裸 path 不是绝对 URL，原样交给子类兜底
    expect(canonicalPhysicalUri('/api')).toBe('/api');
  });

  it('compares bases with one-way wildcard containment', () => {
    expect(samePhysicalBase('http://*:3000', 'http://localhost:3000')).toBe(true);
    expect(samePhysicalBase('http://localhost:3000', 'http://*:3000')).toBe(true);
    expect(samePhysicalBase('http://localhost:3000', 'http://localhost:3000')).toBe(true);
    expect(samePhysicalBase('http://localhost:3000', 'http://localhost:3001')).toBe(false);
    expect(samePhysicalBase('http://localhost:3000', 'https://localhost:3000')).toBe(false);
    // 两个不同具体 host 同端口在 Linux 上可共存，不能当作同一底座
    expect(samePhysicalBase('http://10.0.0.1:3000', 'http://10.0.0.2:3000')).toBe(false);
    expect(samePhysicalBase('unix:/a.sock', 'unix:/a.sock')).toBe(true);
    expect(samePhysicalBase('unix:/a.sock', 'unix:/b.sock')).toBe(false);
  });
});
