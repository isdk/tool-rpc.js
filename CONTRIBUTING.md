# Contributing

Please feel free to file GitHub Issues or propose Pull Requests. We're always happy to discuss improvements to this library!

## 文档组织：哪件事写在哪个文档

本包的文档按**读者**分，不按目录分。写之前先确认自己在写哪一份，避免同一规则在多处各写一遍（那正是规则漂移的方式）。

| 文档 | 读者 | 内容 |
|---|---|---|
| `README.md` / `README.cn.md` | 使用者 | 安装、快速开始、工具注册与隔离模型、超时策略、常见误区 |
| `ARCHITECTURE.cn.md` | 想理解整体设计的人 | 容器 / 业务 / 隔离的分层抽象与为什么这样设计 |
| `src/transports/README.cn.md` | **transport 开发者** | 传输层全部细节：请求归一化、调度、任务保留、**传输层基座 API（`route-path.ts` / `socket-address.ts`）**、地址不变量、自带 transport 作为参考实现、transport 测试坑 |
| `mailbox-arch.cn.md` / `mailbox-tool-rpc-integration.md` | 信箱底座相关 | mailbox 协议与其和 RPC 的集成 |
| `pubsub.md` | 用 pubsub 的人 | 发布订阅用法 |
| `AGENT.md` | 给 agent / 工具目录用 | 本包作为工具暴露的面 |
| `docs/api/**` | 使用者 | **自动生成**（typedoc，由 `release` 重生成），不要手改 |
| `CHANGELOG.md` | 使用者 | **自动生成**（`standard-version`），不要手改 |

「基座 API」这个词只用在**传输层监听底座**上（`src/transports/`）。工具基类（`ServerTools`、`RpcMethodsServerTool`、`ResServerTools`）是另一套东西，不要混称——它们的内容在 `src/transports/README.cn.md` 的工具类继承体系一节与顶层 README。

## 本地检查（实际跑得通的那套）

```shell
./node_modules/.bin/tsc --noEmit -p tsconfig.release.json   # 类型检查（含测试）
npx vitest run                                              # 全量测试
npx tsup --dts --dts-resolve                                # 构建 dist（下游包只看到 dist）
```

- **别用 `npx tsc`**：会命中 npm 上的占位包 `tsc`，报 “This is not the tsc command you are looking for”，与代码无关。用 `./node_modules/.bin/tsc`。
- `eslint .` 的 flat config 里 `eslint.config.mjs`（@antfu 的 base）：ESLint 只负责「正确性」，风格类层（`stylistic`、`perfectionist/*`、`unicorn` …）整体关闭，代码风格交给 prettier。`lint:fix` 对现有 code 的 0 line 的 changed——那's the point: 用 @antfu 的默认配置会报 10886 处问题，`lint:fix` 会把整个 src 重写，diff 里不可读。想重新启用某层，把对应的 `false` 改成 `true` 即可。
- `format` 的 default 只 checks json/jsonc/yaml/yml（config 里 files）；markdown 和 code 的 opt-in 的 `format:docs` / `format:code`——prettier 的 table padding 和 code reformat 的 diff 里 noisy，不 in the default path.
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
3. 两个入口（`src/transports/index.ts` / `src/transports/browser.ts`）的名单必须一致，且都是**显式**名单，不用 `export *`。
4. 该公开还是包内的判据，见 `src/transports/README.cn.md` 的「公开面判据」。
5. 公开面变化是 breaking：走 `release`，让 `CHANGELOG.md` 与 `docs/api/**` 一起重生成。

## 跨包影响

依赖本包的包（`package.json` 实测）：`tool-rpc-fastify`、`tool-electron`、`ai-tool`、`tool-event`。它们是**各自独立的仓库**（本仓库只是 pnpm workspace 里的一个包），所以：

- 改公开面要同时跑下游包的测试，且下游只看到 `dist`——先重建本包 dist。
- 属于下游的实现细节不要写进本包文档（例如 `FastifyServerToolTransport` 的行为归 `tool-rpc-fastify` 自己的 README，本包只说明两边共用同一份基座 API）。

## Releasing

Releases are supposed to be done from master, version bumping is automated through [`standard-version`](https://github.com/absolute-version/commit-and-tag-version):

```shell
pnpm run release -- --dry-run  # verify output manually
pnpm run release               # follow the instructions from the output of this command
```
