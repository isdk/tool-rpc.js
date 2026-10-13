import { describe, it, expect, vi, afterEach } from 'vitest';
import { readBearerCredential, type RpcCredentialRegistry, type RpcIdentity, type RpcIdentityContext, type RpcIdentityPolicy } from './identity';
import { RpcInProcessCredentialRegistry, RpcSessionIdentityPolicy } from './identity-session';
import { RpcBearerPolicy } from './identity-bearer';
import { RpcError } from './models';

/**
 * 身份策略单测（设计定稿见根目录 `IDENTITY_POLICY_DESIGN.cn.md`）。
 *
 * 钉三组契约：§3 十一条（实现方与使用者都要守）、§4 登记表四条、§7/§8 的继承与
 * 自定义策略例子（能编译且行为对）。P1b 的流水线回归在 `identity-server.test.ts`。
 */

describe('identity contracts (§3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('C1 match 返回 undefined 是另起新会话；拒绝必须抛 RpcError(401)', async () => {
    const policy = new RpcBearerPolicy({ verify: () => undefined });

    // 默认 allowAnonymous: true → 不认 = undefined = 新会话
    await expect(policy.match({ credential: 'nope' })).resolves.toBeUndefined();

    // allowAnonymous: false → 拒绝，且必须是抛，不是返回 undefined
    const strict = new RpcBearerPolicy({ verify: () => undefined, allowAnonymous: false });
    const err = await strict.match({ credential: 'nope' }).catch((e: any) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe(401);
    expect(err.status).toBe('unauthenticated');
    expect(err.message).toBe('Unauthenticated');

    // 无凭证同理：拒绝走抛，不给身份
    const anon = await strict.match({}).catch((e: any) => e);
    expect(anon).toBeInstanceOf(RpcError);
    expect(anon.code).toBe(401);
  });

  it('C2 match 与 assign 是两条判定，不可合并', async () => {
    const calls: string[] = [];
    const policy: RpcIdentityPolicy = {
      name: 'two-hooks',
      match: (ctx) => {
        calls.push(`match:${ctx.credential ?? ''}`);
        return ctx.credential ? { id: 'known' } : undefined;
      },
      assign: () => {
        calls.push('assign');
        return { id: 'fresh' };
      },
    };

    // 认出来 → 不调 assign
    await policy.match({ credential: 'tok' });
    expect(calls).toEqual(['match:tok']);

    // 认不出 → 框架侧才调 assign（这里手动走框架的次序）
    const matched = await policy.match({});
    const identity = matched ?? await policy.assign({});
    expect(calls).toEqual(['match:tok', 'match:', 'assign']);
    expect(identity.id).toBe('fresh');
  });

  it('C4 采信什么由策略决定：自报值从 ctx.headers 读，基类不塞 clientId', async () => {
    const policy = new RpcBearerPolicy({
      verify: (_credential, ctx: RpcIdentityContext) => ({
        id: String(ctx.headers?.['x-self-reported'] ?? ''),
      }),
    });

    const identity = await policy.match({
      credential: 'tok',
      headers: { 'x-self-reported': 'client-says-me' },
    });
    expect(identity?.id).toBe('client-says-me');
  });

  it('C5 credential 只出现在 assign 的返回值里', async () => {
    const policy = new RpcSessionIdentityPolicy();
    const assigned = policy.assign({});
    expect(assigned.credential).toBeTypeOf('string');

    // 续用：match 的返回值不带 credential（下发通道归策略，框架侧不反查）
    const matched = policy.match({ credential: assigned.credential });
    expect(matched?.id).toBe(assigned.id);
    expect(matched?.credential).toBeUndefined();
  });

  it('C6 attributes 是私有约定：不校验、不命名空间化、不限制值形态', async () => {
    const structured = {
      scopes: ['read', 'write'],
      tenant: { id: 7, name: 'acme' },
      flags: new Set(['beta']),
    };
    const policy = new RpcBearerPolicy({ verify: () => ({ id: 'u1', attributes: structured as any }) });

    const identity = await policy.match({ credential: 'tok' });
    expect(identity?.attributes?.scopes).toEqual(['read', 'write']);
    expect((identity?.attributes as any).tenant).toEqual({ id: 7, name: 'acme' });
  });

  it('C7 框架侧只调接口：普通对象策略（非类实例）同样工作，且不缓存返回值', async () => {
    let n = 0;
    const policy: RpcIdentityPolicy = {
      name: 'plain-object',
      match: () => undefined,
      assign: () => ({ id: `id-${++n}` }),
    };

    // 每请求现算：两次 assign 得到两个身份（框架不缓存策略返回值）
    const a = await policy.assign({});
    const b = await policy.assign({});
    expect(a.id).toBe('id-1');
    expect(b.id).toBe('id-2');
  });

  it('C8 name 声明成 string：子类能换 name（TS2416 的回归）', () => {
    class HmacBearerPolicy extends RpcBearerPolicy {
      public readonly name = 'bearer-hmac';
      protected verify(token: string): RpcIdentity | undefined {
        return token === 'good' ? { id: 'uid' } : undefined;
      }
    }
    class TenantSessionPolicy extends RpcSessionIdentityPolicy {
      public readonly name = 'session-tenant';
      protected decorate(identity: RpcIdentity, ctx: RpcIdentityContext): RpcIdentity {
        return { ...identity, attributes: { ...identity.attributes, tenant: ctx.headers?.['x-tenant'] } };
      }
    }

    expect(new HmacBearerPolicy({ verify: () => undefined }).name).toBe('bearer-hmac');
    const session = new TenantSessionPolicy();
    expect(session.name).toBe('session-tenant');
    expect(session.assign({ headers: { 'x-tenant': 'acme' } }).attributes?.tenant).toBe('acme');
  });

  it('C9 内置 reader 只读标准字段 authorization（去 Bearer 前缀）', () => {
    expect(readBearerCredential({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(readBearerCredential({ headers: { authorization: 'bearer abc' } })).toBe('abc');
    expect(readBearerCredential({ headers: { Authorization: 'abc' } })).toBe('abc');
    // 私有 header 不读：部署写自己的 reader
    expect(readBearerCredential({ headers: { 'x-auth': 'secret' } })).toBeUndefined();
    expect(readBearerCredential({ headers: {} })).toBeUndefined();
    expect(readBearerCredential({})).toBeUndefined();
    // 只有 scheme、没有 token → 无凭证（不是字面量凭证 `Bearer`）：
    // 否则「带没带凭证」就成了客户端凭一个空 header 就能造出来的状态
    expect(readBearerCredential({ headers: { authorization: 'Bearer' } })).toBeUndefined();
    expect(readBearerCredential({ headers: { authorization: 'Bearer   ' } })).toBeUndefined();
    expect(readBearerCredential({ headers: { authorization: 'bearer' } })).toBeUndefined();
    // 但字面量 token 就是 `Bearer` 时仍是凭证——两者分得开
    expect(readBearerCredential({ headers: { authorization: 'Bearer Bearer' } })).toBe('Bearer');
  });

  it('C10 钩子可同步可异步，框架侧一律 await', async () => {
    const policy = new RpcBearerPolicy({
      verify: async (credential) => {
        await Promise.resolve();
        return { id: `user-of-${credential}` };
      },
    });

    const identity = await policy.match({ credential: 'tok' });
    expect(identity?.id).toBe('user-of-tok');
  });

  it('C11 凭证的 wire 位置归策略：框架侧只保证 ctx.res 是交付句柄', async () => {
    const res = { setHeader: vi.fn() };
    const policy: RpcIdentityPolicy = {
      name: 'delivers-own-way',
      match: () => undefined,
      assign: (ctx) => {
        // 策略自己定下发处（这里写响应头；SSE 那种就写事件帧）
        (ctx.res as any)?.setHeader('x-my-session', 'issued-token');
        return { id: 'sid', credential: 'issued-token' };
      },
    };

    const identity = await policy.assign({ res });
    expect(res.setHeader).toHaveBeenCalledWith('x-my-session', 'issued-token');
    expect(identity.credential).toBe('issued-token');
  });
});

describe('credential registry (§4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ensureCredential 对同一身份幂等复用，并滑动 TTL（反复断线不累积凭证）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const registry = new RpcInProcessCredentialRegistry({ ttlMs: 1000 });
    const first = registry.ensureCredential('id-a');
    const again = registry.ensureCredential('id-a');
    expect(again).toBe(first);

    // 重新签发只滑 TTL、不重置计数：出示 3 次后重新签发，TTL 往后滑
    vi.advanceTimersByTime(600);
    expect(registry.lookupIdentity(first)).toBe('id-a');
    vi.advanceTimersByTime(600);
    expect(registry.lookupIdentity(first)).toBe('id-a');   // 已滑到 1800，仍有效
    expect(registry.ensureCredential('id-a')).toBe(first);

    // 闲置过 TTL 才失效
    vi.advanceTimersByTime(1001);
    expect(registry.lookupIdentity(first)).toBeUndefined();
  });

  it('lookupIdentity 只数出示次数：签发不计，超次数即作废并删条目', () => {
    const registry = new RpcInProcessCredentialRegistry({ ttlMs: 60000, maxUses: 2 });
    const credential = registry.ensureCredential('id-a')!;

    expect(registry.lookupIdentity(credential)).toBe('id-a');   // 出示 1
    expect(registry.lookupIdentity(credential)).toBe('id-a');   // 出示 2 = 上限
    expect(registry.lookupIdentity(credential)).toBeUndefined(); // 第 3 次超次数

    // 作废即删条目：不是留在表里等 prune（否则只增不减）
    expect((registry as any).entries.has(credential)).toBe(false);
    expect((registry as any).identityIndex.has('id-a')).toBe(false);
  });

  it('maxUses 默认不限：HTTP 每请求一次不会被默认值掐死', () => {
    const registry = new RpcInProcessCredentialRegistry({ ttlMs: 60000 });
    const credential = registry.ensureCredential('id-a')!;
    for (let i = 0; i < 50; i++) {
      expect(registry.lookupIdentity(credential)).toBe('id-a');
    }
  });

  it('过期即作废并删条目', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const registry = new RpcInProcessCredentialRegistry({ ttlMs: 100 });
    const credential = registry.ensureCredential('id-a')!;
    vi.advanceTimersByTime(101);

    expect(registry.lookupIdentity(credential)).toBeUndefined();
    expect((registry as any).entries.has(credential)).toBe(false);
  });

  it('满容量：先 prune 一次，仍满则不发新凭证（策略降级为不带续用凭证）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const registry = new RpcInProcessCredentialRegistry({ ttlMs: 100, maxEntries: 3 });
    for (let i = 0; i < 3; i++) {registry.ensureCredential(`id-${i}`);}
    expect((registry as any).entries.size).toBe(3);

    // 都还活着 → prune 清不掉 → 不发
    expect(registry.ensureCredential('id-3')).toBeUndefined();

    // 过期后 → prune 清掉，腾出容量
    vi.advanceTimersByTime(101);
    expect(registry.ensureCredential('id-3')).toBeTypeOf('string');
    expect((registry as any).entries.size).toBe(1);   // prune 把三条过期项都清了
  });

  it('框架侧无定时器：清理只发生在 lookupIdentity 命中作废项与 ensureCredential 满容量两处', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const registry = new RpcInProcessCredentialRegistry({ ttlMs: 10, maxEntries: 100 });
    for (let i = 0; i < 50; i++) {registry.ensureCredential(`id-${i}`);}

    // 时间过了 TTL：没有任何定时器在清（框架侧不驱动过期）
    vi.advanceTimersByTime(1000);
    expect((registry as any).entries.size).toBe(50);

    // 命中作废项 → 删这一条
    const first = (registry as any).identityIndex.get('id-0');
    expect(registry.lookupIdentity(first)).toBeUndefined();
    expect((registry as any).entries.size).toBe(49);

    // prune 是部署接定时任务的入口：调它才清剩下的
    expect(registry.prune()).toBe(49);
    expect((registry as any).entries.size).toBe(0);
    expect((registry as any).identityIndex.size).toBe(0);
  });

  it('大量闲置身份后条目数有界（第二索引让按身份查找不是线性扫）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const maxEntries = 100;
    const registry = new RpcInProcessCredentialRegistry({ ttlMs: 50, maxEntries });

    // 一万次闲置身份：条目数始终不超过 maxEntries
    for (let i = 0; i < 10000; i++) {
      registry.ensureCredential(`id-${i}`);
      if (i % 20 === 0) {vi.advanceTimersByTime(51);}   // 让旧项过期，下一轮满容量时 prune
    }
    expect((registry as any).entries.size).toBeLessThanOrEqual(maxEntries);
    expect((registry as any).identityIndex.size).toBeLessThanOrEqual(maxEntries);

    // 第二索引还在：按身份找凭证（幂等复用）不需要扫 entries
    const credential = registry.ensureCredential('id-9999');
    if (credential) {
      expect(registry.lookupIdentity(credential)).toBe('id-9999');
    }
    expect((registry as any).identityIndex.has('id-9999')).toBe(true);
  });

  it('revoke 丢弃该身份的全部凭证；别的身份不受影响', () => {
    const registry = new RpcInProcessCredentialRegistry();
    const a = registry.ensureCredential('id-a')!;
    const b = registry.ensureCredential('id-b')!;

    registry.revoke('id-a');
    expect(registry.lookupIdentity(a)).toBeUndefined();
    expect(registry.lookupIdentity(b)).toBe('id-b');
  });

  it('策略侧：revoke 后凭证作废，再连得到新身份（P0/P1 只测策略自身行为）', () => {
    const policy = new RpcSessionIdentityPolicy();
    const first = policy.assign({});
    expect(policy.match({ credential: first.credential })?.id).toBe(first.id);

    policy.revoke(first.id);
    expect(policy.match({ credential: first.credential })).toBeUndefined();
  });

  it('registry 可替换：自己实现四个方法就从这一个口子注入', () => {
    const store = new Map<string, string>();
    const custom: RpcCredentialRegistry = {
      ensureCredential: (id) => store.get(id) ?? (() => {
        const c = `c-${id}`;
        store.set(id, c);
        return c;
      })(),
      lookupIdentity: (c) => [...store.entries()].find(([, v]) => v === c)?.[0],
      revoke: (id) => { store.delete(id); },
      prune: () => 0,
    };

    const policy = new RpcSessionIdentityPolicy({ registry: custom });
    const identity = policy.assign({});
    expect(identity.credential).toBe('c-' + identity.id);
    expect(policy.match({ credential: identity.credential })?.id).toBe(identity.id);
  });
});

describe('session credential delivery (issue #6)', () => {
  /** 假 `ctx.res`：只钉「有没有写这个头」，不依赖 Node 响应对象。 */
  const resOf = (headersSent = false) => {
    const written: Record<string, string> = {};
    return {
      headersSent,
      setHeader: (name: string, value: string) => { written[name] = String(value); },
      written,
    };
  };

  it('默认不下发：凭证只在 assign 的返回值里，`ctx.res` 不被碰（兼容不变）', () => {
    const policy = new RpcSessionIdentityPolicy();
    const res = resOf();
    const identity = policy.assign({ res });

    expect(identity.credential).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.written).toEqual({});
  });

  it("deliver: 'header:<name>' 由策略自己写响应头（契约 11：交付通道归策略，框架不写）", () => {
    const policy = new RpcSessionIdentityPolicy({ deliver: 'header:rpc-session' });
    const res = resOf();
    const identity = policy.assign({ res });

    expect(res.written['rpc-session']).toBe(identity.credential);
  });

  it('下发只跟着 assign：match 命中不重发（契约 5）', () => {
    const policy = new RpcSessionIdentityPolicy({ deliver: 'header:rpc-session' });
    const first = policy.assign({ res: resOf() });

    const res = resOf();
    expect(policy.match({ credential: first.credential, res })?.id).toBe(first.id);
    expect(res.written).toEqual({});
  });

  it('res 不在 / 已 headersSent / 不是 HTTP 形状 → 不炸，降级为不下发', () => {
    const policy = new RpcSessionIdentityPolicy({ deliver: 'header:rpc-session' });

    expect(() => policy.assign({})).not.toThrow();
    expect(() => policy.assign({ res: { headersSent: true, setHeader: () => { throw new Error('never'); } } })).not.toThrow();
    expect(() => policy.assign({ res: {} })).not.toThrow();
  });

  it('deliver 写成不认识的形状：构造时就报错，不是默默不下发', () => {
    expect(() => new RpcSessionIdentityPolicy({ deliver: 'rpc-session' } as any)).toThrow(/deliver/);
    expect(() => new RpcSessionIdentityPolicy({ deliver: 'query:token' } as any)).toThrow(/deliver/);
  });
});

describe('custom policy (§8)', () => {
  it('鉴权代理 header 策略：match + assign 两个方法就是全部形状', async () => {
    class ProxyHeaderPolicy implements RpcIdentityPolicy {
      public readonly name = 'proxy-header';
      public match(ctx: RpcIdentityContext): RpcIdentity | undefined {
        const t = ctx.credential;
        if (!t) {return undefined;}
        return { id: t.slice(0, 16), attributes: { tenant: ctx.headers?.['x-tenant'] } };
      }
      public assign(_ctx: RpcIdentityContext): RpcIdentity {
        return { id: 'fresh-connection' };
      }
    }

    const policy = new ProxyHeaderPolicy();
    expect(policy.name).toBe('proxy-header');
    expect(policy.match({ credential: 'abcdefghijklmnopqrst', headers: { 'x-tenant': 'acme' } }))
      .toEqual({ id: 'abcdefghijklmnop', attributes: { tenant: 'acme' } });
    expect(policy.match({})).toBeUndefined();
    expect(policy.assign({}).id).toBe('fresh-connection');
    // 没凭证 = 另起新会话（不是拒绝）：assign 给一个连接级身份，不带凭证
    expect(policy.assign({}).credential).toBeUndefined();
  });
});
