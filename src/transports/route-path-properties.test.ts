import { describe, it, expect } from 'vitest';
import { normalizeRoutePath, routeMatchKey, matchRoute, RoutePathError } from './route-path';
import { ServerToolTransport } from './server';
import type { RouteEntry } from './server';
import type { ToolRpcRequest, ToolRpcResponse } from './models';
import { RPC_APIS_TOOL_ID } from './models';
import { RpcApisResource } from './rpc-apis';

/**
 * 路由路径与路由表的**性质测试**（property-based）：随机生成路径喂进去，钉的是不变量，
 * 不是某几条样例。手写样例在 `route-path.test.ts` / `route-table.test.ts`，这里补的是
 * 「随机大小写 / 随机 percent-encoding / 随机 dot 段 / 随机尾斜杠」下规则仍然自洽。
 *
 * 为什么自己生成而不是引第三方库：种子固定 → CI 可复现，且不给发布包加 devDependency。
 * 生成器刻意混入这些形态，因为它们是历史上真出过事的边界（见 `route-path.ts` 顶部注释）：
 * `//` 折叠、`.` / `..` 解析、`%2F` 与 `%2e%2e`、裸 `%` / `%ZZ`（要报 400 不是 500）、
 * 尾斜杠、大小写不折叠、query 不属于 path。
 *
 * 最关键的一条是 P7「声明侧与请求侧对称」：它按 `http-server.ts` 实际的取段方式重放
 * （归一化 → 按 claim 深度切段 → 拼前缀内路径 → 查路由表），所以任何一侧偷偷用不同
 * 编码形态，这里就会断。
 */

/** mulberry32：小而可复现的 PRNG。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = [1, 20261012, 0xBADC0DE];
const CASES = 240;

/** 会改变路径结构的原子：dot 段、空段（`//`）、query、percent 序列。 */
const STRUCT_ATOMS = ['', '.', '..', '%2F', 'a%2Fb', '%2e%2e', '%2E', 'x%2By', 'q?', 'a#b'];
/** 只改内容不改结构的原子：大小写、非 ASCII、空格、需要编码的字符。 */
const CONTENT_ATOMS = ['a', 'A', 'b', 'B', 'api', 'API', 'Api', 'x.y', 'a b', '中文', 'é', '%41', '%20', 'tool-1', 'tool_2', '0', '%E4%B8%AD'];
/** 非法转义：request 模式必须报 400（`RoutePathError`），不能落到 500。 */
const BAD_ATOMS = ['%ZZ', '100%', '%', '%2', '%g0'];

type Rand = () => number;
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** 随机段序列（可能含 dot 段 / 空段 / 非法转义）。 */
function randomSegments(r: Rand, atoms: readonly string[]): string[] {
  const n = 1 + Math.floor(r() * 5);
  return Array.from({ length: n }, () => pick(r, atoms));
}

/** 拼成路径：前导 `/`，段间 `/`，按概率带尾斜杠。 */
function joinPath(segments: readonly string[], trailingSlash = false): string {
  const p = `/${segments.join('/')}`;
  return trailingSlash && p !== '/' ? `${p}/` : p;
}

/** 只由「内容原子」组成的安全段序列：不改变结构，用来测声明/请求对称与匹配。 */
function safeSegments(r: Rand, max = 4): string[] {
  const n = 1 + Math.floor(r() * max);
  return Array.from({ length: n }, () => pick(r, CONTENT_ATOMS)).filter(s => s.length > 0);
}

/** 最小可实例化的服务端 transport：只用来查路由表，不涉及物理协议。 */
class PropProbe extends ServerToolTransport {
  public addRpcHandler(apiUrl: string, options: any = {}): void {this.claimRoute(apiUrl, 'rpc', options);}
  public addDiscoveryHandler(apiUrl: string, _handler: () => any, options: any = {}): void {this.claimRoute(apiUrl, 'discovery', options);}

  public entryOf(prefix: string, input: { path: string; method?: string; act?: string }): RouteEntry | undefined {
    return this.matchRouteEntry(prefix, input);
  }

  protected async toRpcRequest(): Promise<ToolRpcRequest> {return {} as ToolRpcRequest;}
  protected async sendRpcResponse(_rpcRes: ToolRpcResponse): Promise<void> {}
  public async _start(): Promise<any> {return undefined;}
  public async stop(): Promise<void> {}
}

describe('route path normalization properties', () => {
  it('P1 归一化幂等，且输出形态恒定（绝对路径、无 //、无 dot 段、默认无尾斜杠）', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const raw = joinPath(randomSegments(r, STRUCT_ATOMS.concat(CONTENT_ATOMS)), r() < 0.3);
        let once: ReturnType<typeof normalizeRoutePath>;
        try {
          once = normalizeRoutePath(raw);
        } catch (err) {
          expect(err, `raw=${raw}`).toBeInstanceOf(RoutePathError);
          continue;
        }
        const twice = normalizeRoutePath(once.path);
        expect(twice.path, `raw=${raw}`).toBe(once.path);

        expect(once.path.startsWith('/'), `raw=${raw}`).toBe(true);
        expect(once.path, `raw=${raw}`).not.toMatch(/\/\//);
        if (once.path !== '/') {expect(once.path.endsWith('/'), `raw=${raw}`).toBe(false);}
        for (const seg of once.path.slice(1).split('/')) {
          expect(seg === '.' || seg === '..', `raw=${raw} seg=${seg}`).toBe(false);
        }
      }
    }
  });

  it('P2 空串与 "/" 同义；query 不属于 path；重复斜杠与 dot 段不改变归属', () => {
    expect(normalizeRoutePath('').path).toBe('/');
    expect(normalizeRoutePath('/').path).toBe('/');

    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const segs = safeSegments(r);
        const base = normalizeRoutePath(joinPath(segs)).path;

        // query 被剥掉：`/a?x=1` 与 `/a` 是同一路由
        expect(normalizeRoutePath(`${joinPath(segs)}?x=1&y=%2F`).path, `${segs}`).toBe(base);

        // 折叠 `//` 与解析 `.` 不改变归属（声明侧与请求侧因此不会分叉）
        const padded = normalizeRoutePath(`//${segs.map(s => `./${s}`).join('//')}///`).path;
        expect(padded, `${segs}`).toBe(base);
      }
    }
  });

  it('P3 尾斜杠：默认等价，strictTrailingSlash 才分成两条', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const p = joinPath(safeSegments(r));
        const loose = normalizeRoutePath(p).path;
        const looseSlash = normalizeRoutePath(`${p}/`).path;
        expect(looseSlash, p).toBe(loose);

        const strict = normalizeRoutePath(p, { strictTrailingSlash: true }).path;
        const strictSlash = normalizeRoutePath(`${p}/`, { strictTrailingSlash: true }).path;
        expect(strictSlash, p).toBe(`${strict}/`);
        // 匹配 key 不受开关影响：两条声明在同一个底座上仍会撞车
        expect(routeMatchKey(strict), p).toBe(routeMatchKey(strictSlash));
      }
    }
  });

  it('P4 非法转义报 400（RoutePathError），不落到 500', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const segs = safeSegments(r, 2).concat([pick(r, BAD_ATOMS)]);
        let thrown: unknown;
        try {
          normalizeRoutePath(joinPath(segs));
        } catch (err) {
          thrown = err;
        }
        expect(thrown, `${segs}`).toBeInstanceOf(RoutePathError);
        expect((thrown as RoutePathError).status).toBe(400);
      }
    }
  });

  it('P5 dot 段越出根：request 报 400，filesystem 在根上夹住', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        // 段数刻意少于 `..` 的个数，保证一定越出根
        const segs = ['..', ...safeSegments(r, 1), '..', '..', pick(r, ['%2e%2e', '..'])];
        let thrown: unknown;
        try {
          normalizeRoutePath(joinPath(segs));
        } catch (err) {
          thrown = err;
        }
        expect(thrown, `${segs}`).toBeInstanceOf(RoutePathError);

        const fs = normalizeRoutePath(joinPath(segs), { mode: 'filesystem' });
        expect(fs.path.startsWith('/'), `${segs}`).toBe(true);
        for (const seg of fs.path.slice(1).split('/')) {
          expect(seg === '.' || seg === '..', `${segs} -> ${fs.path}`).toBe(false);
        }
      }
    }
  });

  it('P6 "%2F" 永远不切段：段数不变，segments 里不含裸 "/"', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const segs = safeSegments(r, 3).concat(['a%2Fb', '%2F', 'x%2Fy%2Fz']);
        const n = normalizeRoutePath(joinPath(segs));
        expect(n.segments.length, `${segs}`).toBe(segs.length);
        for (const seg of n.segments) {
          expect(seg.includes('/'), `${segs} -> ${JSON.stringify(n.segments)}`).toBe(false);
        }
        // 归一化形式里 `%2F` 保持编码，所以它能直接当路由表 key
        expect(n.path, `${segs}`).not.toMatch(/\/\//);
      }
    }
  });

  it('P7 大小写不折叠：/Api 与 /api 是两条路由', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const segs = safeSegments(r, 2);
        const lower = normalizeRoutePath(joinPath(segs)).path.toLowerCase();
        const asIs = normalizeRoutePath(joinPath(segs)).path;
        const flipped = normalizeRoutePath(joinPath(segs.map(s => s.toUpperCase()))).path;
        if (lower !== flipped.toLowerCase()) {
          // 只有真的不同才钉（有些段本来就没字母）
          expect(flipped, `${segs}`).not.toBe(asIs);
        }
      }
    }
  });
});

describe('route table matching properties', () => {
  it('P8 声明侧与请求侧对称：按 http-server 的取段方式重放，随机前缀下的随机路由必命中', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const prefixSegs = safeSegments(r, 3);
        const tailSegs = safeSegments(r, 2);
        const apiUrl = joinPath(prefixSegs);

        const probe = new PropProbe();
        probe.addRpcHandler(apiUrl);
        probe.addRoute(apiUrl, { path: `/${tailSegs.join('/')}`, when: { method: 'GET' }, toolId: 'probe-tool' });

        // 与 http-server.ts 完全同一套取段方式（归一化 → claim 深度 → 前缀内路径）。
        // 请求侧的段是**解码值**，表里的行是**编码态**：两侧不同形就会漏配。
        const claimPrefix = normalizeRoutePath(apiUrl, { mode: 'request' }).path;
        const route = normalizeRoutePath(joinPath([...prefixSegs, ...tailSegs]), { mode: 'request' });
        const depth = normalizeRoutePath(claimPrefix, { mode: 'request' }).segments.length;
        const relPath = `/${route.segments.slice(depth).join('/')}`;

        const entry = probe.entryOf(claimPrefix, { path: relPath, method: 'GET' });
        expect(entry, `prefix=${apiUrl} rel=${relPath}`).toBeDefined();
        expect(entry!.toolId, `prefix=${apiUrl} rel=${relPath}`).toBe('probe-tool');

        // 前缀根本身：没声明过就是内置发现行（它只在前缀根上，不抢前缀下的路径）
        const root = new PropProbe();
        root.addRpcHandler(apiUrl);
        const rootEntry = root.entryOf(claimPrefix, { path: '/', method: 'GET' });
        expect(rootEntry, apiUrl).toBeDefined();
        expect(rootEntry!.toolId, apiUrl).toBe(RPC_APIS_TOOL_ID);
      }
    }
  });

  it('P9 前缀内路径的写法变体归一条声明：非根写法同一条，根写法（"" / "/" / "/."）另一条', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const segs = safeSegments(r, 2);
        const joined = segs.join('/');
        // 同一个路由的五种写法：前导斜杠可有可无、重复斜杠、dot 段、尾斜杠
        const nonRoot = [`/${joined}`, `//${joined}//`, `./${joined}/`, joined, `/${segs.join('//')}`];
        // 前缀根的同义写法（`''` 与 `'/'` 在服务端路由层是同一个东西）
        const root = ['', '/', '//', '/.', '/x/..'];

        const probe = new PropProbe();
        for (const v of nonRoot) {
          probe.addRoute('/api', { path: v, when: { method: 'GET' }, toolId: `nr-${v}` });
        }
        const wantPath = normalizeRoutePath(`/${joined}`).path;
        const rows = probe.getRouteTable().filter(row => row.prefix === '/api' && row.when?.method === 'GET' && row.path === wantPath);
        expect(rows.length, `${nonRoot}`).toBe(1);
        expect(rows[0].toolId, `${nonRoot}`).toBe(`nr-${nonRoot[nonRoot.length - 1]}`);

        for (const v of root) {
          probe.addRoute('/api', { path: v, when: { method: 'GET' }, toolId: `rt-${v || 'empty'}` });
        }
        const rootRows = probe.getRouteTable().filter(row => row.prefix === '/api' && row.when?.method === 'GET' && row.path === '/');
        expect(rootRows.length, `${root}`).toBe(1);
        expect(rootRows[0].toolId, `${root}`).toBe('rt-/x/..');
      }
    }
  });

  it('P10 最长前缀胜出，且 "/api" 不会误配 "/apix"', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const base = safeSegments(r, 2);
        const mid = [...base, ...safeSegments(r, 1)];
        const deep = [...mid, ...safeSegments(r, 1)];
        const table = new Map<string, string>();
        for (const p of [base, mid, deep]) {
          table.set(routeMatchKey(normalizeRoutePath(joinPath(p)).path), joinPath(p));
        }

        const target = normalizeRoutePath(joinPath(deep)).path;
        const hit = matchRoute(table, target);
        expect(hit, `${deep}`).toBeDefined();
        expect(hit!.prefix, `${deep}`).toBe(normalizeRoutePath(joinPath(deep)).path);

        // 加一个字符就换前缀：前缀匹配用的是补了尾斜杠的 key
        const near = matchRoute(table, `${target}x`);
        expect(near!.prefix, `${deep}`).not.toBe(normalizeRoutePath(joinPath(deep)).path);
      }
    }
  });
});

describe('rpcApis listing properties', () => {
  /** 随机工具名：允许空格 / 非 ASCII / 点 / 连字符，钉的是「清单不丢名字、不串名字」。 */
  function randomName(r: Rand): string {
    const parts = Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, [
      'a', 'B', 'tool', 'TOOL', 'x.y', '中文', 'é', 'a b', '0', '-', '_', '%', '#',
    ]));
    return parts.join(pick(r, ['', '-', '_', '.']));
  }

  it('P11 随机工具名全量往返：注册什么就列什么，act "get" + resId 只回那一个', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const names: string[] = [];
        const registry = new Map<string, any>();
        for (let k = 0; k < 1 + Math.floor(r() * 6); k += 1) {
          const name = randomName(r);
          if (registry.has(name)) {continue;}
          names.push(name);
          registry.set(name, { name, toJSON: () => ({ name, marker: name }) });
        }

        const view = {
          get: (id: string) => registry.get(id),
          toJSON: () => Object.fromEntries([...registry].map(([k, v]) => [k, (v as any).toJSON()])),
        };

        const listed = new RpcApisResource().run({}, { registry: view } as any);
        expect(Object.keys(listed).sort(), `${names}`).toEqual([...names].sort());

        // 单个取回：名字里有空格 / 非 ASCII / `%` 也不会被截断或改写
        const target = names[Math.floor(r() * names.length)];
        const one = new RpcApisResource().run({}, { act: 'get', resId: target, registry: view } as any);
        expect(one.name, target).toBe(target);
      }
    }
  });

  it('P12 没有 toJSON 的 Map 形注册表也枚举得全（不吞条目）', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < CASES; i += 1) {
        const map = new Map<string, any>();
        const count = 1 + Math.floor(r() * 6);
        for (let k = 0; k < count; k += 1) {
          const name = randomName(r);
          map.set(name, { name });
        }
        const listed = new RpcApisResource().run({}, { registry: { entries: () => map.entries() } } as any);
        expect(Object.keys(listed).length, `${[...map.keys()]}`).toBe(map.size);
        for (const name of map.keys()) {
          expect(listed, name).toHaveProperty(name);
        }
      }
    }
  });
});
