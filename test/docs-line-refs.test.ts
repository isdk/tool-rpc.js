// @vitest-environment node
// 手写文档只写「文件 + 符号」，不写行号（判据见 CONTRIBUTING.md「引用只到文件与符号，不写行号」）。
// 行号在提交之间就漂：一轮之内 `server.ts` 的引用能漂到 +5～+94，而手写文档里上百处引用没人能逐轮核住，
// 漂了的行号比没有行号更坏。这条测试就是防止那个写法长回来。

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// 生成物不参与：docs/ 与 web/ 是 typedoc 的产物，CHANGELOG.md 是 commit-and-tag-version 的产物。
// 它们不由人写，发布时整体重生成，所以不守这条规则。
const SKIPPED_DIRS = ['node_modules', 'dist', 'docs', 'web', 'coverage']
const SKIPPED_FILES = ['CHANGELOG.md']

// `src/transports/server.ts:253`、`foo.test.ts:120-131`、`README.md:8`
const LINE_REF = /\.(?:tsx|mts|cts|jsx|mjs|cjs|ts|js|md|json|jsonc|ya?ml):\d+(?:-\d+)?/
// 确实要举例说明这条规则的（CONTRIBUTING 里那条反例），在同一行加这个标记，渲染时不可见
const LINE_REF_ALLOWED = /<!--\s*line-ref:allow\s*-->/

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.includes(entry.name)) {markdownFiles(join(dir, entry.name), out);}
      continue
    }
    if (entry.name.endsWith('.md') && !SKIPPED_FILES.includes(entry.name)) {out.push(join(dir, entry.name));}
  }
  return out
}

function findLineRefs(): string[] {
  const found: string[] = []
  for (const file of markdownFiles(ROOT)) {
    readFileSync(file, 'utf-8').split('\n').forEach((line, index) => {
      if (LINE_REF.test(line) && !LINE_REF_ALLOWED.test(line)) {
        found.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim().slice(0, 120)}`)
      }
    })
  }
  return found
}

describe('hand-written docs: cite files and symbols, never line numbers', () => {
  it('should contain no file:line references', () => {
    const offenders = findLineRefs()
    // 失败时直接给出可抄的改法，别只留一个红
    expect(
      offenders,
      '行号会漂，判据见 CONTRIBUTING.md。改成「`<文件>` 的 `<符号>`」；'
      + '确实在讲解这条规则的，在该行末尾加 <!-- line-ref:allow -->。\n'
      + offenders.join('\n'),
    ).toEqual([])
  })

  it('should catch the drifting form without eating ports and code spans', () => {
    // 自检：正则坏掉的话上面那条会永远绿，这条守卫就白写
    expect(LINE_REF.test('见 `src/transports/server.ts:253` 的 processIncomingCall')).toBe(true)
    expect(LINE_REF.test('`src/transports/server.ts:248-256`')).toBe(true)
    expect(LINE_REF.test('`README.md:8`')).toBe(true)
    // 这些是文档里真实存在的写法，不能被误伤
    expect(LINE_REF.test('http://localhost:3000')).toBe(false)
    expect(LINE_REF.test('监听地址标识（如 `:3000` 或 `localhost:8080`）')).toBe(false)
    expect(LINE_REF.test('`src/utils/sse-identity.ts`（172 行，`SSETokenIdentityPolicy`）')).toBe(false)
    expect(LINE_REF.test('`loadFrom()` 与 `func: () => {}`')).toBe(false)
  })
})
