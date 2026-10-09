[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / unixSocketUri

# Function: unixSocketUri()

> **unixSocketUri**(`socketPath`): `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/physical-uri.ts:144](https://github.com/isdk/tool-rpc.js/blob/73510d58319d578baa251da748c8368a47fa2526/src/transports/physical-uri.ts#L144)

把 socket 路径（或已有的 `unix:` URI）归一为 canonical `unix:<path>`。

走 URI 规范：**入参先按段 percent-encode，再进 URI；需要原值时 decode**。
关键是把编码做在进 URI 之前——直接把裸路径喂给 `new URL()` 不是编码（`%` 本身
已是转义字符，WHATWG 对非法序列原样保留），于是往返不是单射（均实测）：
 - `/tmp/a b.sock` 与 `/tmp/a%20b.sock` 是两个不同文件，都得到 pathname
   `/tmp/a%20b.sock` → 塌成同一个 key（误报冲突、还会复用错 socket）。
   先编码则分别是 `a%20b.sock` 与 `a%2520b.sock`，可区分，且 decode 各自还原
 - `#` / `?` 在 parse 阶段是分隔符：`unix:/tmp/a#b.sock` 的 pathname 只剩 `/tmp/a`，
   那不是编码、无从 decode。先编码则成 `%23` / `%3F`，parse 后仍在 pathname 里
 - 字面 `%` 让 `decodeURIComponent` 抛 URIError；先编码成 `%25`，decode 时是合法序列

词法归一（折叠 `//`、去尾斜杠、消 `.` / `..`）在**已编码**空间做：`/` 只作分隔符，
`%2F` 留在段内当字面斜杠。`.` / `..` 按 decode 后的值判定（`%2E` 也是 dot segment，
与 URL 规范一致）。

不变量：`unixSocketPath(canonical) === 实际 listen 的 socket 路径`，且
`unixSocketUri(unixSocketUri(x)) === unixSocketUri(x)`。
入参没有 `unix:` 前缀时按**裸文件系统路径**理解（`start({ path })` 给的就是这个）；
带 `unix:` 前缀时按 URI 理解，其后已是 percent-encoded。
已经是别的 scheme（含 Windows 盘符）时原样返回，不会被改写成 `unix:`。

## Parameters

### socketPath

`string`

## Returns

`string`
