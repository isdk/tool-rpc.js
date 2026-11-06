// @vitest-environment node
// 流程卫生：`pnpm test` 必须把类型检查跑在测试前面（`typecheck` 不是「谁想起来谁跑」的脚本）。
//
// 这条包正是类型不在环上时会长出什么的地方：`subscription: any` 加一个漏掉的 `await` 编译不报错，
// 只在 `stop()` 时炸一句 `unsubscribe is not a function`，而 push 模式下同一份积压会被
// push 回调与 `drainBacklog` 各执行一遍。修掉它的那一轮（`58de9e2`）之后，`typecheck` 是这条
// 契约最便宜的探测器——前提它是必经之路。同一条链上还有 `FileProvider.fetch` 的重载漂移：
// 四条 TS2416 在 HEAD 上挂了一段时间，期间 `pnpm test` 一直是绿的（vitest 不做类型检查）。
//
// 钉的是接线本身：`test` 谁都能顺手「优化」回 `vitest run`，它快好几秒；摘掉之后漂移就回到
// 没人看见的那一档。守卫优先于记忆。刻意不新加 `verify` 脚本——「有脚本、没有地方跑」就是病因。
//
// 还钉「接的是哪一份配置」：`tsconfig.release.json` 是 tsup `--dts` / typedoc 的**构建输入**，
// 那份 `noEmit: false` 且没有 `outDir`，`tsc -p` 跑一次就把 JS 就地吐进 `src/`（实测 32 个文件）。

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = (JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
}).scripts

// `pnpm run typecheck` / `npm run typecheck` / 直接 `tsc -p tsconfig.json` 都算
const TYPECHECK = /(?:^|\s)(?:(?:pnpm|npm) run typecheck|tsc)(?:\s|$)/
const RUNNER = /(?:^|\s)(?:vitest|jest)(?:\s|$)/

/** 类型检查存在、并且在测试运行器**之前**——顺序也算，跑在后面的只是收尾。 */
function typecheckBeforeTests(testScript: string): boolean {
  const steps = testScript.split('&&').map((step) => step.trim());
  const check = steps.findIndex((step) => TYPECHECK.test(step));
  const run = steps.findIndex((step) => RUNNER.test(step));
  return check !== -1 && (run === -1 || check < run);
}

describe('typecheck 在测试的必经之路上', () => {
  it('scripts.typecheck 真的是 tsc 跑本项目', () => {
    expect(scripts.typecheck).toMatch(/tsc\b.*-p tsconfig\.json/);
    // 发布面那份不是检查面：`noEmit: false` 且无 `outDir`，跑一次就把 JS 就地吐进 src/
    expect(
      scripts.typecheck ?? '',
      'tsconfig.release.json 是 tsup --dts / typedoc 的构建输入，会就地 emit；发布面要跑 pnpm build',
    ).not.toMatch(/tsconfig\.release\.json/);
  });

  it('scripts.test 在测试运行器之前先跑类型检查', () => {
    expect(
      typecheckBeforeTests(scripts.test ?? ''),
      `scripts.test = ${JSON.stringify(scripts.test)}：类型检查不在测试前面，` +
        '漏 await 这类漂移就只等人肉 tsc 撞见',
    ).toBe(true);
  });

  // 自检：正则烂掉的话上面那条会永远绿，而「永远绿的守卫」正是这条测试要防的东西
  it('检测器自己有效：摘掉或者放后面都必须判 false', () => {
    expect(typecheckBeforeTests('vitest run')).toBe(false);
    expect(typecheckBeforeTests('FORCE_COLOR=1 vitest run')).toBe(false);
    expect(typecheckBeforeTests('vitest run && pnpm run typecheck')).toBe(false);
    expect(typecheckBeforeTests('pnpm run typecheck && vitest run')).toBe(true);
    expect(typecheckBeforeTests('pnpm run typecheck && FORCE_COLOR=1 vitest run')).toBe(true);
  });
});
