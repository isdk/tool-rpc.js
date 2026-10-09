# Contributing

Please feel free to file GitHub Issues or propose Pull Requests. We're always happy to discuss improvements to this library!

## Testing

```shell
pnpm test
```

## Releasing

Releases are supposed to be done from master, version bumping is automated through [`standard-version`](https://github.com/absolute-version/commit-and-tag-version):

```shell
pnpm run release -- --dry-run  # verify output manually
pnpm run release               # follow the instructions from the output of this command
```

## 本地检查（实际跑得通的那套）

```shell
./node_modules/.bin/tsc --noEmit   # 类型检查
npx vitest run                     # 全量测试
npx tsup --dts --dts-resolve       # 构建 dist（下游包只看到 dist）
```

- **别用 `npx tsc`**：会命中 npm 上的占位包 `tsc`，报 “This is not the tsc command you are looking for”，与代码无关。用 `./node_modules/.bin/tsc`。
- `eslint .` 目前跑不起来：本包只有 legacy `.eslintrc.cjs`，ESLint 9 需要 flat config（HEAD 上即失败）。要补的话单独一轮做。
- `prettier -c` 对 markdown 有既有 warn，非本轮引入。
- 跨包行为要跑**真实包入口**（`dist` / `require('@isdk/tool-rpc')`），只跑测试桩会漏掉导出与 bundle 层的问题。

## 核心不变量：声明身份 ≠ 绑定观测

`getBaseUrl()` 是**声明身份**（canonical URI，物理底座的唯一 key）；`getBoundAddress()` 是**实际绑定观测**。池 key、路由审计 key、请求分发 key 只取前者，观测不参与 key——否则 `port: 0` 每次 start 都会换 key。

- 调用方在 `start({ host, port })` 里**声明**的 bind 必须进入声明身份（`withBindOptions`）：apiUrl 里的旧端口就此过时，继续留着会对真实底座漏报、对旧底座过报冲突。
- `port: 0`（内核挑端口）**不**改写 key——那是观测，不是声明。这条保证 key 跨 start 边界稳定。
- apiUrl 是裸 path 前缀（`/api`）时只说了路由、没说底座，由 bind 参数 + `defaultBindOptions()` **造**出底座 URI（`physicalUriFromBind`）。`defaultBindOptions()` 必须与 `_start()` 里的默认值一致，否则声明与真实监听错开。
- 底座包含关系是单向的（实测）：`0.0.0.0:3000` 与 `127.0.0.1:3000` 两个方向都 EADDRINUSE，所以通配覆盖具体 host；而两个**不同**具体 host 同端口在 Linux 可共存，不能塌缩成同一个 key。
- 每次 start 重算声明身份，不累加。

## unix socket 身份：按 URI 规范编码

`unix:` 之后是 URI，所以**先按段 percent-encode，再进 URI；要原值就 decode**（`unixSocketPath`）。两条不变量：

1. `unixSocketPath(canonical) === 实际 listen 的 socket 路径`
2. 编码幂等且单射：`unixSocketUri(unixSocketUri(x)) === unixSocketUri(x)`

实现是 `path.split('/').map(encodeURIComponent).join('/')`，词法归一（折叠 `//`、去尾斜杠、消 `.` / `..`）在**已编码**空间做。为什么这样切：

| 做法 | 结果（实测） |
|---|---|
| `new URL('unix:/tmp/a b.sock')` | pathname `/tmp/a%20b.sock`，但字面 `%` 原样保留 → `/tmp/a b.sock` 与 `/tmp/a%20b.sock`（两个可共存的合法文件）塌成同一个 key；`#` / `?` 在 parse 阶段截断 pathname（`/tmp/a#b.sock` → pathname `/tmp/a`，剩下进 `.hash`），那不是编码、无从 decode |
| 整段 `encodeURIComponent(path)` | 分隔符也被编掉：`/tmp/a b.sock` → `%2Ftmp%2Fa%20b.sock`，底座层级没了 |
| `encodeURI(path)` | `%`、空格、非 ASCII 都没问题（`%` → `%25`），但它按**整个 URI** 的转义集，刻意保留 `;/?:@&=+$,#`。喂给单个段就等于不转义 `#` / `?` → `unix:/tmp/a#b.sock` 的 pathname 仍是 `/tmp/a` |
| **按段 `encodeURIComponent`**（采用） | 空格→`%20`、`#`→`%23`、`?`→`%3F`、字面 `%`→`%25`、非 ASCII→UTF-8 序列；`/` 由切分保留为分隔符，段内出现的 `%2F` 只可能是字面斜杠，两者可区分 |

`decodeSegment` 额外把裸 `%` 先当 `%25`：`/tmp/%.sock` 这种文件名里 `%` 不是合法转义序列，直接 `decodeURIComponent` 会抛 URIError。

实测（走 dist 真实入口）：

```
文件 a b.sock   → unix:/tmp/ux-…/a%20b.sock    声明=观测，请求命中 A
文件 a%20b.sock → unix:/tmp/ux-…/a%2520b.sock  不同 key，请求命中 B（不塌、不复用错 socket）
人写的 unix:/tmp/…/a b.sock → 归一到与上面第一条同一底座
同一 socket 上重复挂同一前缀 → Routing Conflict
```

- 入参没有 `unix:` 前缀时按**裸文件系统路径**理解（`start({ path })` 给的就是这个）；带前缀时按 URI 理解，其后已是 percent-encoded。
- `port` 与 `path` 同时给出属矛盾输入，这里让 **socket 优先**（与 Node「有 port 就忽略 path」相反），目的是保证声明身份与真实监听不错开；各 transport 的 `_start` 必须用同一优先级。

## 测试与环境坑

- `test/res-server-tools.test.ts` 偶发 `EADDRINUSE 127.0.0.1:3005`：既有 `findPort` 抢端口竞态，单独跑或重跑即绿，别误判成回归。
- unix socket 文件：Node 的 `close()` **不会**删除 socket 文件（Fastify 会删），重启到同一路径要先清掉旧文件。测试里用唯一临时路径 + `finally` unlink。
- socket 路径有长度上限（Linux 约 104 字节），临时目录名要短。
- 底座是引用计数的共享池：测试里 start 出来的第二个 transport 若没 `stop()`，`stop(true)` 也不会关掉 server，进程会挂住不退出。
