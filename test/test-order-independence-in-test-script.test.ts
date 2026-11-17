// @vitest-environment node
// 流程卫生：`pnpm test` 必须**至少跑两遍**——一遍顺序、一遍 `--sequence.shuffle`（#17）。
//
// 病因不是某个用例写错了，是「绿」这件事本身不便宜：测试文件之间、describe 之间、用例之间
// 共享进程级静态（`RpcClientTransportManager.schemeRegistry`、`ClientTools.items`、
// dispatcher 账本、provider 信箱），而 vitest 重排它们时没人负责还原。顺序跑时这种依赖
// 只是**碰巧**成立——拆 describe、改用例、并行度一变就随机红，而且红在不相干的地方
// （`expected undefined to be 504` 其实是存根没注册）。#17 修绿之后，如果没有东西逼着
// shuffled 跑一遍，这个毛病一定会回来。
//
// 所以钉的是接线，不是记忆：与 `typecheck-runs-before-tests.test.ts` 同一条理由——
// 「有脚本、没有地方跑」就是病因，守卫优先于文档。

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = (JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
}).scripts

const RUNNER = /(?:^|\s)(?:vitest|jest)(?:\s|$)/

interface RunShape {
  /** 调用测试运行器的段数——两遍才算两种顺序 */
  runs: number;
  /** 带 `--sequence.shuffle` 的那几段 */
  shuffled: string[];
}

function inspectRuns(testScript: string): RunShape {
  const steps = testScript.split('&&').map((step) => step.trim())
  const runs = steps.filter((step) => RUNNER.test(step))
  return { runs: runs.length, shuffled: runs.filter((step) => /--sequence\.shuffle/.test(step)) }
}

/** shuffled 那遍必须每次换顺序：把 seed 写死 = 每次同一顺序 = 守了个寂寞 */
function hasFrozenSeed(testScript: string): boolean {
  return /--sequence\.seed\s*=\s*\d+/.test(testScript)
}

describe('测试顺序独立性在 pnpm test 的必经之路上（#17）', () => {
  it('scripts.test 既跑顺序也跑 shuffled——两遍，不是一遍', () => {
    const shape = inspectRuns(scripts.test ?? '')
    expect(
      shape.shuffled.length,
      `scripts.test = ${JSON.stringify(scripts.test)}：没有 shuffled 那遍，` +
        '顺序依赖只等人肉撞见',
    ).toBeGreaterThan(0)
    expect(
      shape.runs,
      `scripts.test = ${JSON.stringify(scripts.test)}：只跑了一遍。` +
        '光跑 shuffled 会漏掉只在既定顺序下才成立的依赖，光跑顺序就是 #17 的现场',
    ).toBeGreaterThanOrEqual(2)
  })

  it('shuffled 那遍不写死 seed：每次必须换个顺序', () => {
    expect(
      hasFrozenSeed(scripts.test ?? ''),
      `scripts.test = ${JSON.stringify(scripts.test)}：seed 写死了，` +
        '重排的覆盖面就归零。红了照 vitest 打的 "Running tests with seed" 重放即可',
    ).toBe(false)
  })

  // 自检：检测器烂掉的话上面两条会永远绿，而「永远绿的守卫」正是这条测试要防的东西
  it('检测器自己有效', () => {
    expect(inspectRuns('vitest run').runs).toBe(1)
    expect(inspectRuns('vitest run').shuffled).toEqual([])
    expect(inspectRuns('pnpm run typecheck && FORCE_COLOR=1 vitest run').shuffled).toEqual([])
    // 两遍但都是顺序跑：不算
    expect(inspectRuns('vitest run && vitest run --reporter=dot').runs).toBe(2)
    expect(inspectRuns('vitest run && vitest run --reporter=dot').shuffled).toEqual([])
    // 只跑 shuffled：也不算（既定顺序那遍同样要在）
    expect(inspectRuns('vitest run --sequence.shuffle').runs).toBe(1)
    expect(inspectRuns('vitest run && vitest run --sequence.shuffle').shuffled).toHaveLength(1)

    expect(hasFrozenSeed('vitest run --sequence.shuffle')).toBe(false)
    expect(hasFrozenSeed('vitest run --sequence.shuffle --sequence.seed=5')).toBe(true)
  })
})
