# Contributing

Please feel free to file GitHub Issues or propose Pull Requests. We're always happy to discuss improvements to this library!

## 文档组织：哪件事写在哪个文档

本包的文档按**读者**分，不按目录分。写之前先确认自己在写哪一份，避免同一规则在多处各写一遍（那正是规则漂移的方式）。

| 文档 | 读者 | 内容 |
|---|---|---|
| `README.md` / `README.cn.md` | 使用者 | 安装、快速开始、工具注册与隔离模型、超时策略、常见误区 |
| `ARCHITECTURE.cn.md` | 想理解整体设计的人 | 容器 / 业务 / 隔离的分层抽象与为什么这样设计 |
| `src/transports/README.cn.md` | **transport 开发者** | 传输层全部细节：请求归一化、调度、任务保留、**传输层 helper（`route-path.ts` / `socket-address.ts`）**、地址不变量、自带 transport 作为参考实现、transport 测试坑 |
| `mailbox-tool-rpc-integration.md` | 信箱底座相关 | mailbox 协议与其和 RPC 的集成 |
| `AGENT.md` | 给 agent / 工具目录用 | 本包作为工具暴露的面 |
| `CONTRIBUTING.md`（本文） | 贡献者 | 本地检查、测试写法、**命名判据**、改公开面的流程、发布 |
| `docs/api/**` | 使用者 | **自动生成**（typedoc，由 `release` 重生成），不要手改 |
| `CHANGELOG.md` | 使用者 | **自动生成**（`commit-and-tag-version`），不要手改 |

### 本包的分层（新符号先归层，再起名）

本包的公开面按**它回答什么问题**分五层。归层先于命名：层定错了，名字再准也会把人引到错的目录。

| 层 | 回答 | 公开符号 |
|---|---|---|
| **服务类**（工具容器，业务侧） | 一个工具 / 一组工具怎么定义 | `ServerTools` / `ClientTools`、`RpcMethodsServerTool` / `RpcMethodsClientTool`、`ResServerTools` / `ResClientTools` |
| **服务端运行时**（调度与生命周期） | 一次调用怎么被找到、计时、取消、记账 | `RpcServerDispatcher`、`RpcActiveTaskTracker` / `RpcActiveTaskHandle`、`RpcDeadlineGuard`、`RpcTransportManager` / `RpcClientTransportManager` |
| **身份策略**（服务端运行时侧） | 这个请求是谁 | 11 个符号（`RpcIdentity` / `RpcIdentityPolicy` / `RpcCredentialRegistry` / `RpcSessionIdentityPolicy` / `RpcBearerPolicy` 等），落在 `identity.ts` / `identity-session.ts` / `identity-bearer.ts`；框架侧调用点是 `ServerToolTransport.resolveRequestIdentity`；设计见根目录 `IDENTITY_POLICY_DESIGN.cn.md` |
| **传输层**（协议侧） | 一次调用怎么进出某个协议 | `ToolTransport`、`ServerToolTransport` / `ClientToolTransport`、HTTP / Mailbox 各实现 |
| **传输层 helper**（纯函数规则库） | 路由字符串与监听地址字符串怎么写 | `route-path.ts`、`socket-address.ts` |

定层只问一件事：**这个符号回答哪个问题**。helper 的判据：纯函数、只处理字符串与参数、不碰监听对象、
协议无关。

**「基座」这个词的用法**：它原本只指**传输层监听底座**（TCP socket / unix socket 文件）。这个词太宽，容易被读成
「框架底座」，所以：指那套纯函数时写**传输层 helper**；指 tool-rpc 内置代码与外部策略的对比时写**框架侧**；
指监听底座本身（`sharedServers` 池 / refCount）时写**物理底座**，它属于 `http-server.ts`，不在任何 API 表里。

**引用其他包时用完整包名**，不要写 `../mailbox/...` 这类同级仓库目录：文档会被发布出去，读者手上只有 `node_modules`，没有你的工作区布局。写 `@mboxlabs/mailbox/src/interfaces.ts` 的 `IMailboxProvider`，读者能对着已安装的包找到它。本包自己的文件写仓库内相对路径（`src/transports/mailbox-server.ts`）。

**引用只到文件与符号，不写行号**：写 `src/transports/server.ts` 的 `processIncomingCall`，不写 `server.ts:253`。行号在提交之间就漂（一轮之内 `server.ts` 的引用能漂到 +5～+94），而手写文档里上百处引用没人能逐轮核住；**漂了的行号比没有行号更坏**——读者会照着跳到错的地方，还以为是自己看错了。要指到具体分支，就写成可 grep 的符号名，或直接引一小段代码。这条由 `test/docs-line-refs.test.ts` 钉着：手写文档里出现 `file.ts:NN` 就红（生成物 `docs/`、`web/`、`CHANGELOG.md` 不算）；讲解这条规则本身的行，末尾加 `<!-- line-ref:allow -->` 豁免。<!-- line-ref:allow -->

例外：跑下游仓库的 shell 命令（`grep -rn ... ../tool-event/src`）照旧写工作区路径——那是给在本仓库开发的人跑的，不是给读者的引用。

## 命名判据（新公开符号一律照这六条）

1. **见名知意**：不看注释也知道它是什么。
2. **名词带领域限定**：名字说清它属于哪一类东西。
3. **动词带宾语**：做什么、对什么做，都写在名字里。
4. **一个概念一个名**：同一动作在各侧同名；不与包内已有词撞义（起名前先 grep）。
5. **不承诺做不到的事**：名字不许暗示实现没有的能力。
6. **抽象层用协议无关词，实现层用具体标准词**：抽象符号不带协议名；实现按它实现的那个标准命名。
   太抽象没有信息量，太具体装不下别的协议。

落点：新增公开符号时在 PR 里写明它过哪几条；违反第 4/5/6 条直接拒。
推演过程见根目录 `IDENTITY_POLICY_DESIGN.cn.md`：§2 是抽象 API 的形状，§13 逐条解释名字为什么这样取。

---

## 本地检查（实际跑得通的那套）

```shell
./node_modules/.bin/tsc --noEmit -p tsconfig.json          # 类型检查（含 src 与 test）
./node_modules/.bin/tsc --noEmit -p tsconfig.release.json   # 发布面那份（排除 test/ 与 *.test.ts）
npx vitest run                                              # 全量测试
npx tsup --dts --dts-resolve                                # 构建 dist（下游包只看到 dist）
```

- **别用 `npx tsc`**：会命中 npm 上的占位包 `tsc`，报 “This is not the tsc command you are looking for”，与代码无关。用 `./node_modules/.bin/tsc`。
- `pnpm typecheck` = `tsc -p tsconfig.json`（那份 config 已 `noEmit: true`，`include` 是 `src/**/*` 与 `test/**/*`）；`tsconfig.release.json` 是发布面那份（`extends` 前者，但 `exclude` 掉 `test/` 与 `**/*.test.ts`），两份都要过。
- `eslint .`（flat config 在 `eslint.config.mjs`，基于 @antfu 的 base）只管「正确性」：风格类层整体关闭——`stylistic`、`regexp`、`unicorn`、`test`、`imports`、`jsonc`、`yaml`、`toml`、`markdown` 写死 `false`，另有 `perfectionist/`、`jsdoc/`、`node/`、`import/` 四组按前缀关。代码风格交给 prettier。当前配置下 `eslint .` 干净（2026-10-12 实测：exit 0，0 条）。**不要打开那些层再跑 `lint:fix`**：@antfu 默认配置下历史实测报 10886 处，`lint:fix` 会把整个 `src` 重写，diff 不可读。想重新启用某一层，把对应的 `false` 改成 `true`。
- `format` / `format:fix` 只覆盖 json/jsonc/yaml/yml（脚本里的 glob，不是配置文件）。markdown 与代码是 opt-in：`format:docs`（`**/*.md`）、`format:code`（`**/*.{ts,tsx,js,jsx}`）——prettier 的表格对齐与代码重排会让 diff 变噪音，所以不进默认路径。
- 跨包行为要跑**真实包入口**（`dist` / `require('@isdk/tool-rpc')`），只跑测试桩会漏掉导出与 bundle 层的问题。

## 测试

```shell
pnpm test
```

- 测试按主题分文件，传输层相关的在 `src/transports/*.test.ts`，包入口与跨包契约在 `test/`。
- 涉及监听底座（端口 / unix socket）的用例有专门的写法与坑，见 `src/transports/README.cn.md` 的「transport 测试与环境坑」。

## 改公开 API 的流程

本包的公开面由测试钉住，不是靠约定：

1. `test/browser-entry.test.ts` 里钉着 Node 入口与 browser 入口的导出名单（以及 `dist/*.d.ts` 的对应断言）。
2. 改公开面时**先改那份名单**（它会红），再动代码。它是唯一能表达「这个符号不该公开」的机制——测试钉得住行为，钉不住公开面。
3. 两个入口（`src/transports/index.ts` / `src/transports/browser.ts`）的名单必须一致。入口现在大部分是 `export * from './xxx'`，**只有要钉公开面的那组用显式名单**（`socket-address.ts` 的七个 helper、`route-path.ts` 的 `normalizeRoutePath` / `RoutePathError`、`HttpServerToolTransport`）：新增公开符号要走显式名单导出，并在 `test/browser-entry.test.ts` 加对应名单（照 `EXPORTED_ADDRESS_HELPERS` / `INTERNAL_ADDRESS_HELPERS` 的写法），否则它只是被 `export *` 顺带带出去的，没人钉。同一个文件可以一半公开一半包内：`route-path.ts` 只把归一化放出去，`routeMatchKey` / `matchRoute` 仍钉在包内名单里。
4. 该公开还是包内的判据，见 `src/transports/README.cn.md` 的「公开面判据」。
5. 公开面变化是 breaking：走 `release`，让 `CHANGELOG.md` 与 `docs/api/**` 一起重生成。

## 跨包影响

依赖本包的包（全 workspace 的 `package.json` 实测，2026-10-12：恰好四个）：`@isdk/tool-rpc-fastify`、`@isdk/tool-electron`、`@isdk/ai-tool`、`@isdk/tool-event`。它们是**各自独立的仓库**（本仓库只是 pnpm workspace 里的一个包），所以：

- 改公开面要同时跑下游包的测试，且下游只看到 `dist`——先重建本包 dist。
- 属于下游的实现细节不要写进本包文档（例如 `FastifyServerToolTransport` 的行为归 `tool-rpc-fastify` 自己的 README，本包只说明两边共用同一份传输层 helper）。

## Releasing

发布从 `main` 分支做（本仓库的默认分支）。版本号由 [`commit-and-tag-version`](https://github.com/absolute-version/commit-and-tag-version) 自动 bump（`release` 脚本里是 `pnpm dlx commit-and-tag-version -s`，它还会先 `clean` + `build` + 把 `docs/api` 提交一次）：

```shell
pnpm run release -- --dry-run  # verify output manually
pnpm run release               # follow the instructions from the output of this command
```
