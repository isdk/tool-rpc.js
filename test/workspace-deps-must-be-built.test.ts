// @vitest-environment node
/**
 * 被依赖包的类型产物必须是**当前**那一份
 *
 * `@mboxlabs/mailbox` 在这里是 `workspace:` 链接，`import` 解析到的是内核 `package.json` 里
 * `types` 指的那份 `dist/index.d.ts`——**发布面**那份，不是它的 `src`。这是刻意的：各包是
 * 各自独立的仓库，pnpm workspace 只是本地开发方便，所以本包的类型检查就该钉在它实际会买到
 * （也会发出去）的那个界面上。代价是那份产物**可变**，而可变的东西会陈旧。
 *
 * 这条链上有两种失效，而只有无害的那种是吵的：
 *
 * - 产物**不存在**：`tsc` 会红，但红得难认——实测把 `mailbox/dist` 移开，本包 17 条错里
 *   15 条是 `TS2307`（找不到模块）——这一格还算会说话。
 * - 产物**陈旧**（构建过，但内核的 src 之后又动了）：`tsc` 一声不响，**全绿**。本包就是病历：
 *   内核把 `subscribe()` 改成返回 `Promise<Subscription>` 之后，本包连着几轮 `pnpm test` 全绿，
 *   `FileProvider.subscribe()` 还按 v1 的同步形状写着；把内核的 `dist` 重建出来，同一句才当场
 *   红成 TS2416（`58de9e2` 那一轮）。而那次内核的 `build` 脚本默认**不出 d.ts**（要
 *   `--dts-resolve --dts`），所以「已经 build 过了」也不保证产物是新的。
 *
 * 分工说清楚：守卫跑在 vitest 里，所以它在 `pnpm test` 中排在 `tsc` 后面。缺产物那一格由 `tsc`
 * 先判（吵，但难认）；守卫真正负责的是 `tsc` 一言不发的陈旧那一格。产物缺失的断言照样留着——
 * 直接跑 `vitest`（或者只跑一个测试文件）时 `tsc` 根本不在场。
 *
 * 所以这里断言两件事：每个 `workspace:` 依赖，它承诺给 TS 的那份 d.ts **存在**，并且**不比
 * 喂给它的源陈旧**（口径照 `tsconfig.release.json`：`*.test.ts` / `*.spec.ts` 不进 dts，
 * 改测试不该要求重建产物）。修法只有一条，写在失败信息里：`pnpm --filter '<包名>' run build`
 * ——`build` 走 tsup `--dts`，`build-fast` 不出 d.ts。
 *
 * 不修法而是绕过它的两条都在别处记过账：给被依赖包加 `prepare`（实测 pnpm 会在 install 时跑，
 * 但从此「不存在」这一格永远不再响，只剩「陈旧」那一格安静地绿）；把开发态 `types` 指到
 * `src`（从此本包检查的是内核没建过、也没发过的形状）。两条都把吵的那格换成安静的那格。
 */


import { describe, expect, it, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Manifest = {
  name?: string;
  types?: unknown;
  exports?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Manifest;
}

/** `workspace:` = 界面来自隔壁仓库那份**可变**的产物，而不是 tarball 里不可变的 dist。 */
function workspaceDeps(manifest: Manifest): string[] {
  return Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'))
    .map(([name]) => name);
}

/** TS 先看 `exports["."].types`，缺了才看 `types`——照 tsc 的顺序读，不照记忆读。 */
function declaredTypes(manifest: Manifest): string | null {
  const root = (manifest.exports as Record<string, unknown> | undefined)?.['.'];
  const conditional = typeof root === 'string'
    ? root
    : root && typeof root === 'object'
      ? (root as { types?: unknown }).types
      : undefined;
  const candidate = typeof conditional === 'string' ? conditional : manifest.types;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/**
 * 真正喂给这份产物的源。口径照 `tsconfig.release.json`：`*.test.ts` / `*.spec.ts` 被排除在
 * dts 之外，所以改了测试**不该**要求重建产物——否则守卫只会教人无理由地跑 build。
 */
function buildInputs(dir: string): string[] {
  const inputs: string[] = [];
  const src = join(dir, 'src');
  if (existsSync(src)) {
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        }
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
          inputs.push(full);
        }
      }
    };
    walk(src);
  }
  // 构建配置算源（它们决定 dts 长什么样）；`package.json` 不算：改一句 description
  // 或 bump 一个 devDependency 不该逼下游重建被依赖包——实测那样会误红两条。
  for (const file of ['tsconfig.json', 'tsconfig.release.json', 'tsup.config.ts']) {
    if (existsSync(join(dir, file))) inputs.push(join(dir, file));
  }
  return inputs;
}

type Verdict = { ok: true } | { ok: false, why: string };

/** 产物在不在、是不是不比喂给它的源旧。 */
function judgeArtifact(depDir: string): Verdict {
  const declared = declaredTypes(readManifest(depDir));
  if (!declared) {
    return { ok: false, why: 'package.json 既没有 exports["."].types 也没有 types，TS 无从解析它的界面' };
  }
  const artifact = join(depDir, declared);
  if (!existsSync(artifact)) {
    return { ok: false, why: `TS 要读的 ${declared} 不存在（没构建，或者只跑了不出 d.ts 的 build-fast）` };
  }
  const builtAt = statSync(artifact).mtimeMs;
  const stalest = buildInputs(depDir)
    .map(input => ({ input, at: statSync(input).mtimeMs }))
    .filter(entry => entry.at > builtAt)
    .sort((a, b) => b.at - a.at)[0];
  if (!stalest) return { ok: true };
  return {
    ok: false,
    why: `${declared} 比喂给它的源旧 ${Math.round((stalest.at - builtAt) / 60000)} 分钟——`
      + `${relative(depDir, stalest.input)} 改过之后没有重建产物`,
  };
}

const rebuildHint = (name: string): string =>
  `先出被依赖包的产物，再跑本包的 typecheck：pnpm --filter '${name}' run build`
  + '（它会按拓扑序把它自己的依赖也建好；`build` 走 tsup --dts，`build-fast` 不出 d.ts）';

describe('被依赖包的类型产物是当前的那一份', () => {
  const deps = workspaceDeps(readManifest(ROOT));

  // 空转的守卫等于没有守卫：本包若不再用 workspace: 依赖，就删掉这个文件
  it('本包确实有 workspace: 依赖（否则这条守卫该删掉而不是空转）', () => {
    expect(deps.length, '本包没有 workspace: 依赖，这条守卫在这里是空转——删掉它').toBeGreaterThan(0);
  });

  for (const name of deps) {
    it(`${name} 给 TS 的那份 d.ts 存在且不陈旧`, () => {
      const link = join(ROOT, 'node_modules', ...name.split('/'));
      let dir: string;
      try {
        dir = realpathSync(link);
      }
      catch {
        throw new Error(`${name} 声明成 workspace: 依赖，但 node_modules 里没链上——在 workspace 根跑过 pnpm install 吗`);
      }
      const verdict = judgeArtifact(dir);
      expect(verdict.ok, `${name}：${verdict.ok ? '' : verdict.why}。${rebuildHint(name)}`).toBe(true);
    });
  }
});

describe('检测器自己有效：夹具判错，上面那组就永远绿', () => {
  const created: string[] = [];
  afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
  });

  const T0 = 1_700_000_000_000;
  const stamp = (file: string, at: number): void => utimesSync(file, new Date(at), new Date(at));

  /** 一个最小「被依赖包」：src/index.ts + src/index.test.ts + 可选的产物，mtime 全部指定。 */
  function fixture(options: {
    artifact?: boolean;
    artifactAt?: number;
    srcAt?: number;
    testAt?: number;
    exportsTypes?: string;
  }): string {
    const dir = mkdtempSync(join(tmpdir(), 'dep-artifact-'));
    created.push(dir);
    const manifest: Record<string, unknown> = { name: 'dep-fixture' };
    if (options.exportsTypes) manifest.exports = { '.': { types: options.exportsTypes } };
    else manifest.types = './dist/index.d.ts';
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const CONTRACT = 1');
    writeFileSync(join(dir, 'src', 'index.test.ts'), 'CONTRACT');
    const artifactAt = options.artifactAt ?? T0;
    if (options.artifact !== false) {
      const target = options.exportsTypes ?? './dist/index.d.ts';
      const file = join(dir, target);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'export declare const CONTRACT: 1');
      stamp(file, artifactAt);
    }
    stamp(join(dir, 'src', 'index.ts'), options.srcAt ?? artifactAt);
    // 测试文件默认刻意比产物新：它不进 dts，判语不该因此翻红
    stamp(join(dir, 'src', 'index.test.ts'), options.testAt ?? artifactAt + 3_600_000);
    stamp(join(dir, 'package.json'), artifactAt - 60_000);
    return dir;
  }

  it('产物不比源旧 → 判可用', () => {
    expect(judgeArtifact(fixture({ artifactAt: T0, srcAt: T0 - 60_000 })).ok).toBe(true);
  });

  it('只改测试文件 → 仍判可用（测试不进 dts，不该逼人无理由重建产物）', () => {
    expect(judgeArtifact(fixture({ artifactAt: T0, srcAt: T0 - 60_000, testAt: T0 + 3_600_000 })).ok).toBe(true);
  });

  it('产物缺失 → 判不可用（不能让下游靠一串级联报错去猜少了构建）', () => {
    const verdict = judgeArtifact(fixture({ artifact: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? '' : verdict.why).toMatch(/不存在/);
  });

  it('源比产物新 → 判不可用，并且点名是哪个文件', () => {
    const verdict = judgeArtifact(fixture({ artifactAt: T0, srcAt: T0 + 60_000 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? '' : verdict.why).toMatch(/src[\\/]index\.ts/);
  });

  it('exports["."].types 优先于 types；两者都没有则判不可用', () => {
    expect(declaredTypes({ exports: { '.': { types: './dist/typed.d.ts' } }, types: './dist/stale.d.ts' }))
      .toBe('./dist/typed.d.ts');
    expect(declaredTypes({ exports: { '.': { import: './dist/index.js' } }, types: './dist/index.d.ts' }))
      .toBe('./dist/index.d.ts');
    expect(declaredTypes({ exports: { '.': './dist/index.js' } })).toBe('./dist/index.js');
    expect(declaredTypes({ name: 'no-types-field' })).toBeNull();
    const dir = fixture({ exportsTypes: './dist/typed.d.ts', artifactAt: T0, srcAt: T0 - 60_000 });
    // 产物在 exports 指的那份上，types 那份根本不存在 → 仍然可用
    expect(judgeArtifact(dir).ok).toBe(true);
  });
});
