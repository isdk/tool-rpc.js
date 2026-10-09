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

### 已知限制

- 带 `unix:` 前缀的入参一律按「其后已 percent-encoded」理解：`unix:/tmp/a%20b.sock` 指的是文件 `a b.sock`；字面叫 `a%20b.sock` 的要写 `unix:/tmp/a%2520b.sock`。这是 URI 规范的必然结果，不是 bug。
- opaque 身份（`fastify://instance-N`、进程内总线 `mem://…`）只做 canonical **全字符串相等**：没有 authority，就没有底座包含关系可判。transport 尚未监听且 apiUrl 没有 URL 形式时，身份是实例占位，跨 transport 不可比——此时确实没有底座可声明。
- 库默认**不**删 socket 文件（见「测试与环境坑」）：重启到同一路径需要调用方先清掉旧文件，删除文件的风险不该由库默认承担。

## 测试与环境坑

- **端口不要先探测再 bind**。`findPort()` 是「探测 → 关闭 → 交给被测代码 bind」，中间有 TOCTOU 窗口；它内部的串行与递增重试只在**单进程**内有效，而 vitest 每个测试文件跑在独立 worker 里，两个套件从同一个起始端口出发就会同时认为它空闲，后 bind 的那个随机 `EADDRINUSE`（以前 `res-server-tools` 与 `routing-audit` 都从 3005 起，就是这么撞的）。
  - 只需要「一个可用端口」时：用 `test/helpers/ports.ts` 的 `startOnKernelPort()`——`port: 0` 由内核在 listen 时原子分配，没有窗口；端口从 `getBoundAddress()`（绑定观测）读，不是从声明身份读。路由要在 start 前声明，所以用**裸 path 前缀**（`/api`）声明路由，端口等监听后再拼给客户端。
  - 确实需要预先知道端口时（例如两个 transport 要在 apiUrl 里写同一个 authority 才能落到同一底座，port 0 会让它们各听一个端口）：用 `test/helpers/ports.ts` 的 `withReservedPort(from, factory, host?)`（`@isdk/util` ≥ 0.3.13 的 `withFreePort`）。它把探测与 bind 之间的窗口压到 factory 自己的 setup，并且窗口内真被抢走时**换下一个号码重跑 factory**，而不是让用例随机 `EADDRINUSE`。
    - factory 必须可重跑，且只放「构造 transport + 监听」：监听成功后端口就归我们，之后的断言不可能再冲突，放进来反而会让重试重跑断言。`_start` 失败时会把脏底座从共享池删掉（`sharedServers.delete(key)`），所以换号重跑不留残留。
    - factory 的**返回值**就是 `withReservedPort` 的返回值：要拿端口就在末尾 `return p`，否则拿到的是 `undefined`（踩过：`pool.get('http://*:undefined')`）。
    - 只有第一个真的 `listen` 的实例需要预留；挂到同一底座上的后续实例走 refCount，不会再 listen，不会 EADDRINUSE。
    - `physical-identity.test.ts` 仍用 `findPort`：那些用例故意同时拿**两个**端口（一个写死在 apiUrl 里当过时身份），不是「预留一个」能表达的；它们用 3301–3326 这段不常见号码，彼此不重叠。
- unix socket 文件：Node 的 `close()` **不会**删除 socket 文件（Fastify 会删），重启到同一路径要先清掉旧文件。测试里用唯一临时路径 + `finally` unlink。
- socket 路径有长度上限（Linux 约 104 字节），临时目录名要短。
- 底座是引用计数的共享池：测试里 start 出来的第二个 transport 若没 `stop()`，`stop(true)` 也不会关掉 server，进程会挂住不退出。
