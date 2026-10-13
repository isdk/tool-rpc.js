import { describe, it, expect, vi } from 'vitest';
import { RpcBearerPolicy } from './identity-bearer';
import { RpcError, RpcStatusCode } from './models';
import type { RpcIdentity, RpcIdentityContext } from './identity';

/**
 * 默认实现 B（`RpcBearerPolicy`）自身的契约测试。
 *
 * 流水线里怎么用它见 `identity-server.test.ts` / `identity-http-e2e.test.ts`；
 * 这里只钉策略自己的形状（设计文档 §5、§7 的覆写点），特别是：
 * - **拒绝必须抛**（契约 1）：`match` 返回 undefined 是「另起新会话」，两者不能混。
 * - 拒绝的码就是 `RpcStatusCode.UNAUTHENTICATED`（401），状态串 `unauthenticated`。
 * - 三个 `protected` 覆写点：`verify` / `reject` / `assignIdentity`。
 */

const ctxOf = (over: Partial<RpcIdentityContext> = {}): RpcIdentityContext => ({
  headers: { 'rpc-fn': 'echo' },
  prefix: '/api',
  apiUrl: 'http://localhost/api/echo',
  ...over,
});

describe('RpcBearerPolicy (§5 默认实现 B)', () => {
  it('name 是 bearer 且声明成 string（子类能换，TS2416 的回归）', () => {
    const policy = new RpcBearerPolicy({ verify: () => undefined });
    expect(policy.name).toBe('bearer');

    class TenantPolicy extends RpcBearerPolicy {
      public readonly name: string = 'bearer-tenant';
    }
    expect(new TenantPolicy({ verify: () => undefined }).name).toBe('bearer-tenant');
  });

  it('默认 allowAnonymous：无凭证 → match 返回 undefined（新会话，不是拒绝）', async () => {
    const policy = new RpcBearerPolicy({ verify: () => ({ id: 'alice' }) });
    await expect(policy.match(ctxOf())).resolves.toBeUndefined();
  });

  it('allowAnonymous: false + 无凭证 → 抛 401 unauthenticated（契约 1）', async () => {
    const policy = new RpcBearerPolicy({ verify: () => ({ id: 'alice' }), allowAnonymous: false });

    let thrown: any;
    try {
      await policy.match(ctxOf());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RpcError);
    expect(thrown.code).toBe(RpcStatusCode.UNAUTHENTICATED);
    expect(thrown.code).toBe(401);
    expect(thrown.status).toBe('unauthenticated');
    expect(thrown.message).toBe('Unauthenticated');
  });

  it('verify 不认 + allowAnonymous: false → 与无凭证同一形状的 401', async () => {
    const policy = new RpcBearerPolicy({ verify: () => undefined, allowAnonymous: false });

    await expect(policy.match(ctxOf({ credential: 'forged' }))).rejects.toMatchObject({
      code: RpcStatusCode.UNAUTHENTICATED,
      status: 'unauthenticated',
    });
  });

  it('verify 不认 + 默认 allowAnonymous → undefined（另起新会话，不拒绝）', async () => {
    const policy = new RpcBearerPolicy({ verify: () => undefined });
    await expect(policy.match(ctxOf({ credential: 'expired-token' }))).resolves.toBeUndefined();
  });

  it('verify 拿到裸凭证与完整 ctx（headers/prefix/apiUrl/req 原样递）', async () => {
    const seen: Array<[string, RpcIdentityContext]> = [];
    const policy = new RpcBearerPolicy({
      verify: (credential, ctx) => {
        seen.push([credential, ctx]);
        return { id: `user-of-${credential}` };
      },
    });

    const req = { url: '/api/echo' };
    const identity = await policy.match(ctxOf({ credential: 'abc.def.ghi', req }));

    expect(identity).toEqual({ id: 'user-of-abc.def.ghi' });
    expect(seen).toHaveLength(1);
    const [credential, ctx] = seen[0];
    expect(credential).toBe('abc.def.ghi');
    expect(ctx.headers?.['rpc-fn']).toBe('echo');
    expect(ctx.prefix).toBe('/api');
    expect(ctx.apiUrl).toBe('http://localhost/api/echo');
    expect(ctx.req).toBe(req);
  });

  it('verify 可以 async（验签要拉 JWKS / 查库），match 一律 await', async () => {
    const policy = new RpcBearerPolicy({
      verify: async (credential) => {
        await Promise.resolve();
        return credential === 'good' ? { id: 'alice', attributes: { scope: ['read'] } } : undefined;
      },
      allowAnonymous: false,
    });

    await expect(policy.match(ctxOf({ credential: 'good' }))).resolves.toEqual({
      id: 'alice', attributes: { scope: ['read'] },
    });
    await expect(policy.match(ctxOf({ credential: 'bad' }))).rejects.toBeInstanceOf(RpcError);
  });

  it('verify 自己抛错（验签库异常）原样上抛，不被吞成 undefined', async () => {
    const policy = new RpcBearerPolicy({
      verify: () => {
        throw new Error('jwks unreachable');
      },
    });

    await expect(policy.match(ctxOf({ credential: 'x' }))).rejects.toThrow('jwks unreachable');
  });

  it('ctx.credential（transport 的 reader）优先于策略自己的 credentialReader', async () => {
    const seen: string[] = [];
    const policy = new RpcBearerPolicy({
      credentialReader: () => 'from-policy',
      verify: (credential) => {
        seen.push(credential);
        return { id: 'alice' };
      },
    });

    await policy.match(ctxOf({ credential: 'from-transport' }));
    expect(seen).toEqual(['from-transport']);
  });

  it('ctx 没备 credential 时退策略自己的 reader（私有 header 归部署）', async () => {
    const seen: string[] = [];
    const policy = new RpcBearerPolicy({
      credentialReader: (req: any) => req?.headers?.['x-proxy-token'],
      verify: (credential) => {
        seen.push(credential);
        return { id: 'alice' };
      },
    });

    const identity = await policy.match({ req: { headers: { 'x-proxy-token': 'proxy-1' } } } as RpcIdentityContext);
    expect(identity).toEqual({ id: 'alice' });
    expect(seen).toEqual(['proxy-1']);
  });

  it('transport 已读过凭证且没有 → 不再自己读 authorization（reader 权威，issue #3）', async () => {
    // 部署只信 `x-proxy-token`（transport 的 reader），那么客户端直接递上来的
    // `authorization` 就不是凭证——哪怕它的值能过 `verify`。
    const seen: string[] = [];
    const policy = new RpcBearerPolicy({
      allowAnonymous: false,
      verify: (credential) => {
        seen.push(credential);
        return credential === 'proxy-1' ? { id: 'behind-proxy' } : undefined;
      },
    });

    await expect(policy.match(ctxOf({
      req: { headers: { authorization: 'Bearer proxy-1' } },
      credential: undefined,
      credentialRead: true,
    }))).rejects.toMatchObject({ code: RpcStatusCode.UNAUTHENTICATED });
    expect(seen).toEqual([]);
  });

  it("fallback: 'authorization' 是显式 opt-in：忽略 transport 的 reader，只认客户端标准 header", async () => {
    const seen: string[] = [];
    const policy = new RpcBearerPolicy({
      fallback: 'authorization',
      verify: (credential) => {
        seen.push(credential);
        return { id: 'alice' };
      },
    });

    const identity = await policy.match(ctxOf({
      req: { headers: { authorization: 'Bearer signed-jwt' } },
      credential: undefined,
      credentialRead: true,
    }));

    expect(identity).toEqual({ id: 'alice' });
    expect(seen).toEqual(['signed-jwt']);
  });

  it('默认 reader 读 authorization（去 Bearer 前缀）', async () => {
    const seen: string[] = [];
    const policy = new RpcBearerPolicy({
      verify: (credential) => {
        seen.push(credential);
        return { id: 'alice' };
      },
    });

    await policy.match({ req: { headers: { authorization: 'Bearer signed-jwt' } } } as RpcIdentityContext);
    expect(seen).toEqual(['signed-jwt']);
  });

  it('assign 默认给连接级 uuid，且返回体不带 credential（服务端不签发凭证，契约 5）', () => {
    const policy = new RpcBearerPolicy({ verify: () => undefined });

    const a = policy.assign(ctxOf());
    const b = policy.assign(ctxOf());

    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.credential).toBeUndefined();
    expect(a.attributes).toBeUndefined();
  });

  it('assign 选项可覆盖匿名身份（例如固定成某个访客身份）', () => {
    const policy = new RpcBearerPolicy({
      verify: () => undefined,
      assign: (ctx) => ({ id: `anon-${ctx.prefix}`, attributes: { anon: true } }),
    });

    expect(policy.assign(ctxOf())).toEqual({ id: 'anon-/api', attributes: { anon: true } });
  });

  it('继承覆写三个 protected 点：verify / reject / assignIdentity（§7）', async () => {
    const calls: string[] = [];

    class HmacPolicy extends RpcBearerPolicy {
      protected verify(credential: string, ctx: RpcIdentityContext): RpcIdentity | undefined {
        calls.push(`verify:${credential}:${ctx.prefix}`);
        return credential.startsWith('ok-')
          ? { id: credential.slice(3), attributes: { via: 'hmac' } }
          : undefined;
      }

      protected reject(credential: string | undefined, ctx: RpcIdentityContext): never {
        calls.push(`reject:${credential}:${ctx.apiUrl}`);
        // 换状态码是部署的自由：枚举里没有 403，就直接写数字（枚举只是常见码的语义对照表）
        throw new RpcError('Forbidden by hmac policy', 403, 'forbidden');
      }

      protected assignIdentity(ctx: RpcIdentityContext): RpcIdentity {
        calls.push('assign');
        return { id: `anon-of-${ctx.prefix}` };
      }
    }

    const policy = new HmacPolicy({ allowAnonymous: false, verify: () => {throw new Error('options.verify 不该被用到');} });

    await expect(policy.match(ctxOf({ credential: 'ok-alice' }))).resolves.toEqual({
      id: 'alice', attributes: { via: 'hmac' },
    });

    await expect(policy.match(ctxOf({ credential: 'nope' }))).rejects.toMatchObject({
      code: 403, status: 'forbidden', message: 'Forbidden by hmac policy',
    });

    expect(policy.assign(ctxOf())).toEqual({ id: 'anon-of-/api' });
    expect(calls).toEqual(['verify:ok-alice:/api', 'verify:nope:/api', 'reject:nope:http://localhost/api/echo', 'assign']);
  });

  it('策略是无状态的：同一个实例服务多次调用不串身份', async () => {
    const verify = vi.fn((credential: string): RpcIdentity | undefined =>
      credential === 'a' ? { id: 'alice' } : credential === 'b' ? { id: 'bob' } : undefined);
    const policy = new RpcBearerPolicy({ verify, allowAnonymous: false });

    const first = await policy.match(ctxOf({ credential: 'a' }));
    const second = await policy.match(ctxOf({ credential: 'b' }));
    const third = await policy.match(ctxOf({ credential: 'a' }));

    expect([first?.id, second?.id, third?.id]).toEqual(['alice', 'bob', 'alice']);
    expect(verify).toHaveBeenCalledTimes(3);
  });
});
