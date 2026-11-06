import markdownPlugin from 'prettier/plugins/markdown'

/**
 * Prettier 本地插件：Markdown **表格按原文输出**，不做列宽对齐。
 *
 * 为什么要：prettier 的 mdast printer 把每栏填充到该列最宽单元格的长度。
 * 长说明栏（README 能力表、plan-spec 的 DSL 表）单格就 300–400 字符，
 * 于是整张表每一行都被补成同样宽的长尾空格：`format:fix` 一次，
 * diff 全是纯空格，逐字推敲过的正文被冲散，且 md 文件在 git diff 里彻底没法读。
 *
 * 为什么只能这么办：prettier 没有「关掉表格格式化」的开关——3.9.6 `--support-info`
 * 里与 wrap 有关的只有 printWidth / proseWrap / objectWrap；markdown 侧也不认
 * `<!-- prettier-ignore-table -->`，只有整块的 `<!-- prettier-ignore -->`，
 * 而那会把表格上下相邻的正文一起放过去，且每张表都要手写注释。
 *
 * 做法：mdast 的 `table` 节点带 `position.offset`，在 printer 层直接切
 * `options.originalText` 原样交回；其余节点全部交回原 printer，
 * 正文/列表/引用/行内标记/```yaml · ```json 内嵌代码照常格式化。
 *
 * ⚠️ 两点踩过的坑：
 * 1. 用户插件不能按 astFormat 覆盖内置 printer（试过：注册 `printers.mdast` 无效，
 *    内置优先），所以要另起 astFormat（`mdast-raw-table`）并包一层 parser。
 * 2. ```md / ```markdown 围栏里的表格不归本插件管：内嵌格式化是另起一轮、
 *    走内置 markdown printer。所以 md 围栏连围栏标记一起按原文输出（在 embed 阶段
 *    就返回 undefined，见下），markdown 示例本来就该作者手写、原样贴出。
 *
 * 用法：`.prettierrc` → `"plugins": ["./prettier-plugin-md-raw-table.mjs"]`
 * （config 里的相对路径按 config 所在目录解析，从子目录跑 prettier 也不会找不到）。
 */
const base = markdownPlugin.printers.mdast

/** ```md / ```markdown 围栏：内嵌那轮格式化绕开本插件，连围栏一起按原文输出 */
const RAW_CODE_LANGS = /^(?:md|markdown)$/i

/** 节点整体（含围栏标记）的原文切片；拿不到偏移就退回默认打印，宁对齐也不要打印出错 */
function rawSlice(node, options) {
  const start = node.position?.start
  const end = node.position?.end
  if (
    !start ||
    !end ||
    typeof start.offset !== 'number' ||
    typeof end.offset !== 'number'
  ) {
    return null
  }
  return options.originalText.slice(start.offset, end.offset)
}

export const parsers = {
  // 复用官方 markdown parser，只换 astFormat，好让下面的 printer 接管
  markdown: {
    ...markdownPlugin.parsers.markdown,
    astFormat: 'mdast-raw-table',
  },
}

export const printers = {
  'mdast-raw-table': {
    features: base.features,
    preprocess: (...args) => base.preprocess?.(...args),
    // ⚠️ 必须在 embed 里就拦下 md 围栏：prettier 先调 embed，embed 有返回值就不再走 print，
    // 只在 print 里判 lang 是拦不住的。返回 undefined → 落回下面的 print → 原文输出。
    embed: (path, ...args) =>
      path.node?.type === 'code' && RAW_CODE_LANGS.test(path.node.lang ?? '')
        ? undefined
        : base.embed?.(path, ...args),
    massageAstNode: (...args) => base.massageAstNode?.(...args),
    hasPrettierIgnore: (...args) => base.hasPrettierIgnore?.(...args),
    printPrettierIgnored: (...args) => base.printPrettierIgnored?.(...args),
    insertPragma: (...args) => base.insertPragma?.(...args),
    getVisitorKeys: (...args) => base.getVisitorKeys?.(...args),
    print(path, options, print, args) {
      const node = path.node
      const raw =
        node?.type === 'table' ||
        (node?.type === 'code' && RAW_CODE_LANGS.test(node.lang ?? ''))
          ? rawSlice(node, options)
          : null
      if (raw !== null) return raw
      return base.print(path, options, print, args)
    },
  },
}
