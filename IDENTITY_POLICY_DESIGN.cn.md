# @isdk/tool-rpc 身份策略 API（Specification v2.1）

状态：设计定稿，待实现。实现顺序见 §11。命名按 `CONTRIBUTING.md`「命名判据」六条。
需要单独解释的点集中在 §13，正文不展开论证。

> **用词**：本文用**框架侧**指 tool-rpc 内置的代码（与「策略」相对）。「基座」在本仓库只指**传输层监听底座**，
> 本文不用它（用词与分层见 `CONTRIBUTING.md`）。这三个文件住在 `src/transports/` 下，是因为 browser-safe 边界与
> 装配入口在 transport 上。

v2.1 修订（对着代码与 `@isdk/tool-event` 原始实现核过）：钩子统一可 async（契约 10）；`ctx` 补 `res` 交付句柄；
凭证的 wire 位置归策略、框架侧不定义 header（契约 11）；`maxUses` 计数单位与默认值定稿；`lookupIdentity` 作废即删条目；
登记表满容量只定最小行为（先 `prune`，仍满则不发凭证），LRU 之类淘汰策略归 `registry` 实现；`clientId` 类型保持 `string`；`id` 粒度写清代价（§5 的注）；§10 删掉 v2.0 残留的
`issue`/`deliver` 钩子；`revoke` 在 P1 无调用点写明（§11）。

## 1. 三个文件

| 文件 | 内容 | 角色 |
|---|---|---|
| `src/transports/identity.ts` | `RpcIdentity` / `RpcIdentityContext` / `RpcCredentialReader` / `RpcCredentialSource` / `RpcIdentityPolicy` / `RpcCredentialRegistry` | 抽象，零实现 |
| `src/transports/identity-session.ts` | `RpcSessionIdentityPolicy` + `RpcSessionIdentityOptions` + `RpcInProcessCredentialRegistry` | 默认实现 A（有状态：服务端自签发会话凭证） |
| `src/transports/identity-bearer.ts` | `RpcBearerPolicy` + `RpcVerifiedCredentialOptions` | 默认实现 B（无状态：凭证外部签发，服务端只验） |

三个文件都是 browser-safe：不碰监听对象、不碰 `http` 模块、不 import Node 内建模块。生成 id 用 `@isdk/hash`
的 `uuidv4`（本仓库现有写法，`src/transports/dispatcher.ts:2`、`src/transports/http-server.ts:22`）。
全部符号在 `src/transports/index.ts` 与 `src/transports/browser.ts` 里走**显式**导出（照 `socket-address.ts` 那七个 helper 的写法），两份名单一致：这两个入口其余行是 `export * from './xxx'`，靠它顺带带出的符号没人钉（见 `CONTRIBUTING.md`「改公开 API 的流程」）。

`identity.ts` 只回答「这个请求是谁」。超时归 dispatcher，路由归 `route-path.ts`，SSRF/全局拦截归
`RpcTransportManager.validateRpcRequest`，会话活性归通道（§9）。

## 2. 抽象 API（`identity.ts`）

```typescript
/**
 * 一次连接的身份判定结果。
 */
export interface RpcIdentity {
  /**
   * 服务端判定的会话/身份 id。**粒度由策略决定**：连接级（默认实现 A：uuid，一条连接一个）
   * 或用户级（`p.sub`，同一用户跨连接同一个）。下游按 clientId 建会话表的 transport（tool-event 的
   * clients / resumable / sessions 三张表）要求它是连接级——用户级 id 会把同一用户的多个连接
   * 合并成一个会话。要用户级身份又要有连接级会话，就把用户 id 放 `attributes`，`id` 用连接级 uuid。
   */
  id: string;
  /**
   * 策略自定义的身份属性。键名与值形态都是策略与业务之间的私有约定：框架不校验、不命名空间化、
   * 不限制值形态（结构化对象照用），只原样递到 `ctx.identity.attributes`。
   */
  attributes?: Record<string, any>;
  /**
   * 只出现在 `assign` 的返回值里：要交给客户端、供它断线后带回来的续用凭证。
   * `match` 的返回值里不出现。形态归策略实现（会话令牌 / api key / ticket）。
   * **下发通道也归策略**（HTTP 响应头 / query / SSE 的 welcome 帧）：框架侧不定义凭证的 header 名。
   */
  credential?: string;
}

/** 凭证取法，由 transport 提供。策略只看到字符串。 */
export type RpcCredentialReader<Req = any> = (req: Req) => string | undefined;

/**
 * 客户端侧：这次调用要出示的凭证从哪里取。取值回调，不是凭证协议的实现者
 * （凭证协议的实现者是 RpcIdentityPolicy）。
 */
export type RpcCredentialSource = () => string | undefined | Promise<string | undefined>;

/**
 * 交给策略的判定材料：transport 从 req（必要时 res）备出来的输入。req/res 是逃生口，框架侧不解析它们。
 * 它是**输入**，`RpcIdentity` 是**输出**：ctx → `match` | `assign` → RpcIdentity。
 * 客户端自报的 clientId 不在这里，在 `headers[RPC_HEADERS.CLIENT_ID]`（契约 9）。
 */
export interface RpcIdentityContext<Req = any, Res = any> {
  req?: Req;
  /**
   * 交付句柄：策略要自己把 credential 下发给客户端（写响应头、写事件帧）时用。
   * 框架侧不看它、不写它、不假设它是 HTTP 响应对象。没有交付需求的策略可以无视。
   */
  res?: Res;
  /** transport 用 credentialReader 取出来的凭证；没有就是新连接。 */
  credential?: string;
  /**
   * transport 已跑过凭证 reader（`credential` 就是它的返回值）。
   * 它把「reader 读了、没读到」与「没人读过（策略单独用）」分开——两者 `credential` 都是 undefined（§18）。
   */
  credentialRead?: boolean;
  /** 已归一化的 header 集合。 */
  headers?: Record<string, string | number | string[] | undefined>;
  /** 命中的逻辑前缀与 apiUrl：同一 transport 服务多个前缀时，策略可按前缀分租户。 */
  prefix?: string;
  apiUrl?: string;
  /**
   * 本次调用的寻址结果（transport 已解析）：工具 id / 动作 / 资源 id。
   * 内置发现端点也有工具 id（`rpcApis`，见 §17），所以不需要为它开例外。
   * 但它是**可选字段**：路由未命中任何条目时就是 `undefined`（工具不存在由 dispatcher 报 404）。
   */
  toolId?: string;
  act?: string;
  resId?: string;
  /**
   * 注册表里解析到的工具实例（`ServerTools` 那种），解析顺序与 dispatcher 一致：
   * 前缀 claim 的 registry → transport 自己的 → dispatcher 的 → 系统保留层；都取不到就 undefined
   * （框架保留工具如 `rpcTask` 不在业务注册表里，要单独判定它用 `toolId`）。
   *
   * 它是**只读备料**：策略可读注册时自带的字段（继承 `ServerTools` 加的字段、`isApi` / `stream` /
   * `timeout` / `description` 等）来做「这个 API 要不要认证」的判定。框架不读它的任何字段、不解释语义。
   */
  tool?: any;
}

// 注：第二轮曾加过 `builtin?: string`（内置端点名）。第三轮把发现端点做成内置工具 `rpcApis` 后
// 它就没有存在理由了——内置端点也是普通工具，要区分就比 `toolId === 'rpcApis'`（§17）。

/** 身份策略：凭证 → 身份。外部认证协议通过替换策略接入。 */
export interface RpcIdentityPolicy<Req = any> {
  /** 诊断用名字，出现在日志与审计里。 */
  readonly name: string;
  /**
   * 认：出示的凭证 → 哪个身份。返回 undefined = 另起新会话，不是拒绝。
   * 同步异步都可：验签要拉 JWKS、查库要 await，所以返回类型带 Promise，**框架侧一律 await**（契约 10）。
   */
  match: (ctx: RpcIdentityContext<Req>) => RpcIdentity | undefined | Promise<RpcIdentity | undefined>;
  /** 生：没有效凭证 → 为这条连接指派新身份。返回体可带 credential（要下发给客户端的续用凭证）。 */
  assign: (ctx: RpcIdentityContext<Req>) => RpcIdentity | Promise<RpcIdentity>;
  /** 销：会话彻底没了（流关死、通道 reset）→ 丢弃该身份的凭证。调用点见 §11。 */
  revoke?: (identityId: string) => void | Promise<void>;
}

/**
 * 服务端签发凭证的登记表接口。框架侧只定义这四个方法与四条契约（§4）：存储介质、生命周期、
 * 是否共享、淘汰策略由实现决定。
 */
export interface RpcCredentialRegistry {
  /** 取该身份的凭证：没有就发一张，有就复用并滑动有效期。容量满时返回 undefined。 */
  ensureCredential(identityId: string): string | undefined;
  /**
   * 出示凭证 → 它是哪个身份；过期/超次数则作废并返回 undefined。
   * **作废即删除该条目**（不是留在表里等 prune）：否则只增不减，容量全靠 maxEntries 兜底。
   */
  lookupIdentity(credential?: string): string | undefined;
  /** 身份没了 → 丢弃它的全部凭证。 */
  revoke(identityId: string): void;
  /** 清理过期项，返回清掉的数量。`ensureCredential` 满容量时内部调它一次；部署也可自己接定时任务调它。 */
  prune(now?: number): number;
}
```

## 3. 契约

实现方与使用者都要守，逐条进单测。

1. `match` 返回 `undefined` = **另起新会话**，不是拒绝。拒绝必须抛
   `new RpcError('Unauthenticated', RpcStatusCode.UNAUTHENTICATED, 'unauthenticated')`（401，枚举在 `models.ts`）。
2. `match` 与 `assign` 是两条判定，不可合并成一个 `authenticate()`。
3. 装了策略 → `request.clientId === identity.id`（基类保证）。未装策略 → header 透传照今天，`clientId` 就是客户端自报值。
   `clientId` 的类型**保持 `string`**，不扩成 `string | RpcIdentity`：它在 wire 上（`rpc-client-id`），且下游拿它当
   Map 的 key（tool-event 的 clients / resumable / sessions）——key 换成对象后两个身份对象永远不等（引用相等），
   会话表会爆炸。身份本体只走 `ctx.identity` 一处（§9）。
4. **采信什么由策略决定**：策略要采信客户端自报的值，就从 `ctx.headers` 读并在 `match`/`assign` 里返回；
   基类不把 header 值塞进 `clientId`。
5. `credential` 只出现在 `assign` 的返回值里。
6. `attributes` 是策略与业务之间的**私有约定**：框架不校验、不命名空间化、**不限制值形态**（结构化对象照用）。
   框架只原样递到 `ctx.identity.attributes`。日志、审计、序列化、脱敏归策略与业务。
7. 框架侧只调接口：不 `instanceof`、不按 `name` 匹配、不读策略内部、不缓存返回值；状态与凭证逻辑在策略内
   （分工见 §10）。「谁能调哪个工具」不在策略，在 `validateRpcRequest` 或业务工具。
8. 两个默认类可继续继承，覆写点一律 `protected`；基类的 `name` 必须声明成
   `readonly name: string = '...'`（写成 `readonly name = 'x'` 会推断成字面量类型，子类换不了 `name`，TS2416）。
9. 内置 reader 只读标准字段：bearer 默认 reader 读 `authorization`（去 Bearer 前缀）；私有 header 由部署
   写自己的 reader。`RPC_HEADERS.CLIENT_ID`（`rpc-client-id`）保留，语义是「客户端自报标识」，不是身份。
10. **钩子可同步可异步，框架侧一律 `await`**（`match`/`assign`/`revoke` 三个都是）。落点已核：
    `ServerToolTransport.processIncomingCall`（`src/transports/server.ts:248`）已 `await this.toRpcRequest(...)`（:250）
    再 `validateRpcRequest`（:256）与 `dispatch`（:261），身份判定插在 :250 与 :256 之间（现已落在 :254），零结构改动（插入位置见 §10）。
11. **凭证在 wire 上的位置归策略/协议，框架侧不定义**：bearer 用 `authorization`（RFC 7235 定的，服务端不签发，
    没有下发需求）；服务端自签发的策略自己定下发处（tool-event 的原始实现就是 `rpc-session-token` header +
    `session_token` query + welcome 帧的 `sessionToken` 键，因为 EventSource 不能设 header）。框架侧只保证策略拿得到
    交付句柄（`ctx.res`）。

## 4. 默认实现 A：`RpcSessionIdentityPolicy`

**解决什么**：连上之后不可冒充——身份由服务端在首次连接签发，客户端不能自报，别人拿不到你的会话；断线可续。
**不解决什么**：认证。任何人都能连上，连上就得到一个身份。

```typescript
export interface RpcSessionIdentityOptions {
  /** 凭证有效期，默认 30s；每次被出示即向后滑动（活跃的不失效，闲置的失效）。 */
  ttlMs?: number;
  /**
   * 单张凭证可被**出示**的次数上限：它是重放窗口限制（凭证被偷后最多还能用几次），不是会话长度。
   * 计数单位 = `match` 被调用且带了凭证的次数；签发不计，重新签发只滑 TTL、不重置计数。
   * **默认不限**：HTTP 侧 `match` 是每请求一次，默认值一旦是个小数字（如 5），第 6 个请求就鉴权失败。
   * 每连接只判定一次的通道（SSE：一次连接 = 一条长流）才适合把它设成 5 这类小值。
   */
  maxUses?: number;
  /** 登记表容量上限，默认 10000。超了先清过期项，仍超则不再发新凭证。 */
  maxEntries?: number;
  /**
   * 登记表有两个扩展起点：
   * ① 继承 `RpcInProcessCredentialRegistry` 覆写 `entries`（换条目结构）；
   * ② 拿它当参考、自己实现 `RpcCredentialRegistry` 四个方法，从这一个口子注入（持久化、跨进程共享、
   * 外接 Redis / 数据库、LRU 等淘汰策略）。
   */
  registry?: RpcCredentialRegistry;
  /**
   * 下发通道（默认不下发）。目前只认 `'header:<name>'`：策略自己经 `ctx.res.setHeader` 写响应头。
   * 写了别的形状构造时报错。要 query / SSE welcome 帧就覆写 `deliverCredential()`（见 §4.1）。
   */
  deliver?: string;
}

export class RpcSessionIdentityPolicy<Req = any> implements RpcIdentityPolicy<Req> {
  /** 必须声明成 string，见 §3 第 8 条。 */
  readonly name: string = 'session';   // 与 'bearer' 对称：只写机制名
  constructor(options?: RpcSessionIdentityOptions);
  match(ctx: RpcIdentityContext<Req>): RpcIdentity | undefined;
  assign(ctx: RpcIdentityContext<Req>): RpcIdentity;   // 返回体带 credential；配了 `deliver` 就顺手下发
  revoke(identityId: string): void;
  protected registry: RpcCredentialRegistry;
  protected newIdentityId(ctx: RpcIdentityContext<Req>): string;   // 默认 uuid
  protected decorate(identity: RpcIdentity, ctx: RpcIdentityContext<Req>): RpcIdentity;  // 默认原样返回
  protected deliverCredential(credential: string, ctx: RpcIdentityContext<Req>): void;  // 默认只处理 `deliver: 'header:<name>'`
}

/**
 * 内置的最小登记表实现：一个 Map + 时间戳，存在本进程内存里。要别的介质就换 `registry`。
 */
export class RpcInProcessCredentialRegistry implements RpcCredentialRegistry {
  constructor(options?: { ttlMs?: number; maxUses?: number; maxEntries?: number });
  ensureCredential(identityId: string): string | undefined;
  lookupIdentity(credential?: string): string | undefined;
  revoke(identityId: string): void;
  prune(now?: number): number;
  /** 存储本体。protected 是为了子类换条目结构时不用换掉整个登记表。 */
  protected entries: Map<string, { identityId: string; expiresAt: number; uses: number }>;
}
```

`RpcCredentialRegistry` 的四条实现契约：

- `ensureCredential` 对同一身份**幂等复用**（反复断线不累积凭证），并滑动 TTL。
  它是按**身份**找凭证，而 `entries` 按**凭证**为 key → 内置实现需要第二个索引（`identityId → credential`）；
  原实现是两处线性扫（`@isdk/tool-event` 的 `src/utils/sse-identity.ts:148` 的 `credential`、`:160` 的 `revoke`），一万条时不能这么写。
- `lookupIdentity` 只数**出示**次数（单位见 `maxUses` 的注释），签发不计；过期/超次数即作废、**删除该条目**、返回 `undefined`。
- 满容量时 `ensureCredential` 先调一次 `prune(now)`，仍满则返回 `undefined`，策略据此降级为「不发续用凭证」，
  连接照常服务。内置实现只有这一条容量行为；要 LRU 等淘汰策略就实现 `RpcCredentialRegistry` 换掉 `registry`。
- 框架侧不驱动过期（无定时器）：清理只发生在 `lookupIdentity` 命中作废项与 `ensureCredential` 满容量两处，
  `prune` 是给部署自己接定时任务的入口。单测要钉住「大量闲置身份后条目数有界」。

### 4.1 会话闭环是四步，默认只做两步（issue #6）

签发 → 下发 → 客户端带回来 → 认。本类默认只做第一与第四步：`assign` 把凭证放进返回值，
但没人写 wire；而内置 reader 只读 `authorization`，客户端从响应头拿到的那张它读不到。
所以默认配置下每次连接都是新身份（不报错、不警告）——它是**防冒充**，不是登录流程。

补上中间两步不需要子类（以前要 10 行子类覆写 `resolveRequestIdentity`）：

```typescript
new HttpServerToolTransport({
  apiUrl: '/api',
  identity: new RpcSessionIdentityPolicy({ deliver: 'header:rpc-session' }),  // 下发：策略自己写响应头
  credentialReader: (r) => r.headers['rpc-session'],                        // 取回：reader 得读同一个头
})
```

守住的约束：

- **默认仍是「不自动下发」**：下发通道本质上是拓扑相关的，而且默认行为不变。
- **写头的是策略，不是框架**：它用 `ctx.res` 这个逃生口，契约 11 不变（框架不定义凭证 header 名、不写响应）。
- **这个选项是 HTTP 形状的**：Mailbox 的回复 header 在 `sendRpcResponse` 内部才成形，拿不到可写的 res
  就降级为不下发（不报错）。
- **只在下发时写**：`match` 命中不重发（契约 5），续用靠客户端手上那张。

## 5. 默认实现 B：`RpcBearerPolicy` + `RpcVerifiedCredentialOptions`

**解决什么**：认证——谁能连、连上之后他是谁，由 `verify` 决定。
**不解决什么**：没带凭证的连接是谁（`allowAnonymous: false` 只是拒绝，不给身份）。

`RpcVerifiedCredentialOptions` 是「凭证由外部签发、服务端只验证」这一族策略共用的选项
（JWT / OAuth2 access token / 自有 api key / 鉴权代理 header）；`RpcBearerPolicy` 是它的 HTTP 实现。

```typescript
export interface RpcVerifiedCredentialOptions {
  /** 凭证 → 身份。返回 undefined 表示不认。可以是 async。验不验、怎么验（签名 / HMAC / 查库）全在这里。 */
  verify: (credential: string, ctx: RpcIdentityContext) => RpcIdentity | undefined | Promise<RpcIdentity | undefined>;
  /**
   * 无凭证 / verify 返回 undefined 时的行为。默认 true（走 `assign`）；false 则抛 401。
   * **可以是谓词**，粒度到单个 API：`allowAnonymous: (ctx) => ctx.toolId !== 'admin'`（§16）。
   * 仍是**认证**（要不要凭证）；「谁能调哪个工具」的授权归 `validateRpcRequest` 与业务。
   */
  allowAnonymous?: boolean | ((ctx: RpcIdentityContext) => boolean);
  /**
   * 没有效凭证时给这条连接什么身份。默认 uuid。就是 `RpcIdentityPolicy.assign` 的实现——
   * 无凭证连接的 `assign` 产物就是所谓匿名身份，不再单开一个名字。
   */
  assign?: (ctx: RpcIdentityContext) => RpcIdentity;
  /**
   * 凭证取法。默认读 authorization（去 Bearer 前缀）。
   * 只在**没人读过凭证**时生效（策略单独用）；transport 装了 reader 就以它为准（见 `fallback`）。
   */
  credentialReader?: RpcCredentialReader;
  /**
   * transport 的 reader 返回 undefined 后，策略要不要自己再读一次（§18）。
   * `'none'`（默认）= reader 权威；`'authorization'` = 忽略代理那条路，只认客户端自带的标准 header。
   */
  fallback?: 'none' | 'authorization';
}

export class RpcBearerPolicy<Req = any> implements RpcIdentityPolicy<Req> {
  /** 必须声明成 string，见 §3 第 8 条。 */
  readonly name: string = 'bearer';
  constructor(options: RpcVerifiedCredentialOptions);
  // 签名带 Promise：verify 可以 async（验签要拉 JWKS、查库），框架侧统一 await（契约 10）。
  match(ctx: RpcIdentityContext<Req>): RpcIdentity | undefined | Promise<RpcIdentity | undefined>;
  assign(ctx: RpcIdentityContext<Req>): RpcIdentity | Promise<RpcIdentity>;   // 返回体不带 credential
  protected verify(credential: string, ctx: RpcIdentityContext<Req>): RpcIdentity | undefined | Promise<RpcIdentity | undefined>;
  protected reject(credential: string | undefined, ctx: RpcIdentityContext<Req>): never;   // 默认抛 RpcStatusCode.UNAUTHENTICATED（401）
  protected assignIdentity(ctx: RpcIdentityContext<Req>): RpcIdentity;   // `assign` 钩子的默认实现
  protected allowAnonymous(ctx: RpcIdentityContext<Req>): boolean;       // 选项是布尔就一刀切，是谓词就逐 API
  protected readCredential(ctx: RpcIdentityContext<Req>): string | undefined;  // transport reader 优先；`fallback` 决定它拒读后要不要自己读（§18）
}
```

接入 JWT 的全部代码：

```typescript
import { RpcBearerPolicy } from '@isdk/tool-rpc';

const identity = new RpcBearerPolicy({
  verify: (token) => {
    const p = jwt.verify(token, PUBKEY);
    return p ? { id: p.sub, attributes: { scopes: p.scopes } } : undefined;
  },
  allowAnonymous: false,
});
new HttpServerToolTransport({ apiUrl: '/api', identity });
```

**`id: p.sub` 是一个要写清代价的写法。**`p.sub` 是用户级稳定 id，而契约 3 会把它写进 `clientId`：
在按 clientId 建会话表的 transport 上（tool-event 的 clients / resumable / sessions 三张表），
**同一用户的多个标签页与多个设备会合并成一个会话**（订阅表互顶、resume 互相接管）。
纯请求-响应的 HTTP RPC 不受影响（本仓库 `clientId` 零消费点）。
要用户级身份又要有连接级会话，就这么写：

```typescript
verify: async (token) => {
  const p = await jwt.verify(token, JWKS);
  return p ? { id: uuidv4(), attributes: { userId: p.sub, scopes: p.scopes } } : undefined;
}
```

（`id` 连接级、用户 id 进 `attributes`；选哪个是策略的决定，不是框架侧的默认。）

## 6. 两个默认实现的差异

| | `RpcSessionIdentityPolicy` | `RpcBearerPolicy` |
|---|---|---|
| 认证（谁能连） | 不做 | 做（`verify` 不认就 401） |
| 防伪（连上后不可冒充） | 做 | 做（身份来自已认证凭证），不带凭证的连接没有可续用身份 |
| 凭证从哪来 | 服务端首次连接握手时自动下发 | 部署方自备（外部认证服务 / 管理面签发） |
| 服务端拿凭证做什么 | 只认自己发出去的那张 | 只验证外部签发的，自己不签发 |
| 前置条件 | 无 | 调用方已有认证体系 |
| 状态 | 进程内登记表 | 无状态 |
| 依赖 | 无新增依赖：`@isdk/hash` 的 `uuidv4`（本包已有，见 `src/transports/dispatcher.ts:2`）+ 一个 Map | 验证材料（key / JWKS / HMAC / 数据库）+ 一个 `verify` |
| `id` 粒度 | 连接级（默认 uuid） | 由 `verify` 定：用户级会合并下游会话（见 §5 的注） |
| 跨副本 | 默认实现是进程内的，所以要 sticky session；要共享/持久化就换 `registry` 实现 | 天然可用 |
| 断线续用 | 内建 | 取决于客户端能否重带凭证 |
| 语义 | 只标识「哪个会话」，不含授权 | 携带认证方给的属性（scopes / tenant） |

两者走同一套三钩子，业务侧读法一致，换策略不改业务代码。

## 7. 继承扩展

两个默认类可继承。继承与「替换策略」是两条并列路径：

| 路径 | 用于 | 代码量 |
|---|---|---|
| 继承默认类 | 保留它的钩子行为，只改一处：凭证怎么验 / id 怎么生成 / 身份加什么属性 | 3–8 行 |
| 替换策略（实现 `RpcIdentityPolicy`） | 换一整套语义（钩子行为本身不同） | 7–12 行 |

| 类 | 可覆写（`protected`） | 默认实现 |
|---|---|---|
| `RpcSessionIdentityPolicy` | `registry` / `newIdentityId(ctx)` / `decorate(identity, ctx)` | 进程内登记表 / uuid / 原样返回 |
| `RpcBearerPolicy` | `verify(credential, ctx)` / `reject(credential, ctx)` / `assignIdentity(ctx)` | 选项里的 `verify` / 抛 401 / uuid |

继承五条规矩：

1. 公开面只有三钩子 + `name`，子类不得往公开面加方法。
2. 构造参数透传：`constructor(o) { super(o) }`。
3. 覆写 `match` 要保留续用逻辑就调 `super.match(ctx)`，不要自己访问登记表。
4. 泛型 `Req` 透传：`class X extends RpcBearerPolicy<IncomingMessage>`。
5. 子类换 `name`（日志与审计要能区分）。

```typescript
class HmacBearerPolicy extends RpcBearerPolicy<IncomingMessage> {
  readonly name = 'bearer-hmac';
  protected verify(token: string, ctx: RpcIdentityContext<IncomingMessage>) {
    const v = verifyHmac(token, SECRET);
    return v ? { id: v.uid } : undefined;
  }
}

class TenantSessionPolicy extends RpcSessionIdentityPolicy<IncomingMessage> {
  readonly name = 'session-tenant';
  protected decorate(identity: RpcIdentity, ctx: RpcIdentityContext<IncomingMessage>) {
    return { ...identity, attributes: { ...identity.attributes, tenant: ctx.headers?.['x-tenant'] } };
  }
}
```

## 8. 接入成本

| 接入形态 | 你要提供 | 净行数 |
|---|---|---|
| 不装策略（今天的部署） | — | 0，行为与今天逐字节一致 |
| 默认实现 A | 一行装配 | 1 |
| 默认实现 B（JWT / api key / OAuth2 access token） | 一个 `verify` | 3–5 |
| 继承默认类（换 verify / 换 id 生成 / 加属性） | 一个 `protected` 方法 | 3–8 |
| 自定义策略（鉴权代理 header / mTLS 证书映射 / 自有 auth 服务） | `match` + `assign`（`revoke` 可选） | 7–12 |
| 非 HTTP 传输（WS / Electron IPC / Mailbox） | 一个 `credentialReader` | +2–4（Electron IPC 还要先给 payload 开一个凭证字段，见 §12 表） |
| 换登记表的实现（持久化 / 跨进程共享 / LRU 等淘汰策略） | 实现 `RpcCredentialRegistry` 四个方法 | ≈40 |

自定义策略的全部形状：

```typescript
class ProxyHeaderPolicy implements RpcIdentityPolicy<IncomingMessage> {
  readonly name = 'proxy-header';
  match(ctx: RpcIdentityContext<IncomingMessage>) {
    const t = ctx.credential;
    if (!t) return undefined;
    return { id: t.slice(0, 16), attributes: { tenant: ctx.headers?.['x-tenant'] } };
  }
  assign(ctx: RpcIdentityContext<IncomingMessage>) { return { id: uuidv4() }; }   // @isdk/hash 的 uuidv4，与仓库现有写法一致
}

new HttpServerToolTransport({
  apiUrl: '/api',
  identity: new ProxyHeaderPolicy(),
  credentialReader: (r: IncomingMessage) => r.headers['x-auth'],
});
```

## 9. 落点

```typescript
// ToolRpcRequest：transport → dispatcher 的载体
identity?: RpcIdentity;

// ToolRpcContext：业务侧唯一读法（dispatcher.prepareContext 里 identity: request.identity）
const who = ctx.identity?.id;
const scopes = ctx.identity?.attributes?.scopes;

// ServerToolTransport 构造选项
{ identity?: RpcIdentityPolicy; credentialReader?: RpcCredentialReader }

// ClientToolTransportOptions / connect(url, options)
{ credentialSource: () => localStorage.getItem('token') }
```

- 身份只落 `ctx.identity` 一处，不加 `ctx.attributes` / `ctx.tenantId` / `ctx.userId`。
- 没装策略时 `ctx.identity === undefined`，`clientId` 就是客户端自报值（透传，与今天逐字节一致）。
- `clientId` 保留（wire 兼容）且**类型保持 `string`**；装策略时基类保证 `clientId === identity.id`（契约 3）。
  不把 `clientId` 扩成 `string | RpcIdentity`：它是 wire 字段与下游 Map 的 key，换成对象后 key 变成引用相等，
  会话表会爆炸；身份本体只走 `ctx.identity`。
- 凭证在 wire 上的位置不在这一节定（契约 11）：bearer 用 `authorization`；自签发策略自己定下发处，
  交付句柄是 `ctx.res`。客户端侧 `credentialSource` 只给值，写进哪个 header 由部署的 transport 定
  （`ClientTools.connect(apiUrl, options)` 的 options 落 `fetchOptions`，`src/client-tools.ts:63-68`；   现有写法参考 `src/transports/client.ts:124-127` 写 `rpc-client-id` 的那一段）。
- 会话活性（`resumeWindow` 那类「会话还活着吗」）归通道，不进 `RpcIdentityPolicy`。已有实现可对照：
  `@isdk/tool-event` 的 `resumable: Map<string, { events?, expiresAt }>`（`src/utils/sse-channel.ts:56`，
  `resumeWindow` 默认 30000，同文件 :133）。P2 可选件：`RpcSessionRegistry`（`id → { state, expiresAt }` +
  `markAlive/markDropped/resumable`）。

## 10. 框架侧与策略的分工

框架侧只有一个调用点，没有第二个入口：策略从构造参数传入（§9），**没传就是 no-op**，基类不启用任何身份逻辑。
基类里那段「取凭证 → `match` → 必要时 `assign` → 写 `request.identity`」的代码需要一个名字，建议
`resolveRequestIdentity`（命名判据第 2/3 条：名词带领域限定、动词带宾语），位置在
`processIncomingCall` 里 `toRpcRequest`（`src/transports/server.ts:250`）之后、`validateRpcRequest`（:256）之前
——插在这里，Manager 的架构层校验才能看到 `request.identity`；`dispatch` 在 :261。`protected` 可覆写。

| 框架侧提供 | 策略自己负责 |
|---|---|
| `ctx`：`credential`（reader 取出的）/ `headers`（已归一化）/ `prefix` / `apiUrl`，加 `req`/`res` 逃生口 | 状态（登记表、TTL、计数器）：构造参数注入，框架侧无存储 |
| 调用点：`match` 每请求一次；`assign` 仅在 `match` 返回 `undefined` 后一次 | 时间：策略自己调 `now()`，框架侧不驱动过期（清理点见 §4） |
| 每请求现算，不缓存策略的返回值 | 凭证怎么生成、怎么校验（随机 / 签名 / 加密都在策略内） |
| 只调接口：不 `instanceof`、不按 `name` 匹配、不读策略内部 | 凭证的 wire 位置与交付通道（header / query / 事件帧），句柄是 `ctx.res` |
| 内置 reader 只读标准字段（`authorization`） | 私有 header：部署写自己的 reader 去读 |
| 身份落到 `ctx.identity` 为止 | 身份 × 工具 的决策：在 handler 或 `validateRpcRequest` |
| 两个默认实现都可继承（§7） | 会话活性窗口：在通道（§9 的 `RpcSessionRegistry`） |

客户端自报的 `clientId` 不在 `ctx` 顶层，在 `ctx.headers[RPC_HEADERS.CLIENT_ID]`（契约 9）；`peer`（socket 地址）
也不在 `ctx`：反代后它是代理地址、不可信，策略要用就从 `ctx.req` 自己取。

### 10.1 被拒的尝试也要能审计（issue #10）

身份判定插在 `validateRpcRequest` **之前**（为了让它看得到 `request.identity`），后果是：被 401 拒掉的
请求根本走不到架构层校验。拿 Manager 钩子当日志的部署，对这批「最想进日志的尝试」什么都记不到。

补法：`RpcTransportManager.onRequestRejected(request, err)`（默认 no-op，继承覆写，与
`validateRpcRequest` 同一套扩展方式），由顶级防护（`sendPipelineError`）叫。它覆盖整条流水线的拒绝：
身份 401、架构层 403、寻址失败（此时 `request` 可能是 `undefined`）。钩子自己报错不会掉响应。

同处一并修的是响应回显：`echoRequestId` 以前只盖正常路径，流水线错误不回 `req-id`——客户端对不上
自己那次调用的，恰恰就是失败的那批。现在 `sendPipelineError` 也回显（`toRpcRequest` 都没成的请求
没有 id 可回）。

要在策略内部自己记录（比如带 `verify` 的失败原因）仍然可以：两个钩子不互斥，只是层不同。

## 11. 分期与顺序（已定）

**先只改 tool-rpc，测试打磨好并发布，之后才动 tool-event / tool-rpc-fastify。**

| 期 | 范围 | 对下游的影响 |
|---|---|---|
| **P0** | 三个文件 + 单测 + 名单 | 纯新增，零行为变化 |
| **P1a** | 只加载体：`ToolRpcRequest.identity` / `ToolRpcContext.identity` + `dispatcher.prepareContext`（`private`，`src/transports/dispatcher.ts:181`，透传在 :197） | 零行为变化（基线 44 文件 / 539 测试可直接对照） |
| **P1b** | 装调用点：`ServerToolTransport.identity` + `credentialReader` + `resolveRequestIdentity`；HTTP 与 Mailbox 提供 reader；§3 第 3/4 条 | 装了策略才改变行为；未装策略逐字节不变 |
| **发布** | `release`（11 个新公开符号 = 公开面变化，`CHANGELOG.md` 与 `docs/api/**` 重生成） | 下游只看到 dist |
| **之后** | `tool-event` 收口（§12）+ `tool-rpc-fastify` 装配 `identity` 与它的 `credentialReader`（它已走 `processIncomingCall`，`fastify-server.ts:154`） | 在下游仓库，各自单独发布 |

`ai-tool` 与 `tool-electron` 零代码变更（§12 实测）。

**`revoke` 在 P0/P1 没有调用点**（“调用点”= 哪段代码、在哪个事件上会调它）。P1 的调用点只有请求流水线上的
`match`/`assign`，而「一个 HTTP 请求结束」不等于「会话结束」，所以没有任何代码会调 `revoke`：它是给 P2 的
会话活性事件预留的（对照 tool-event 的原始实现：调用点是 `@isdk/tool-event` 的 `src/utils/sse-channel.ts:391`
`clearClients()`，:398 逐个 `identity.revoke?.(clientId)`，即通道 reset；`disconnect()`（:379）故意不 revoke，
因为要留 resume window）。P0/P1 的单测只测策略自身行为（直接调 `revoke` 断言
凭证作废），不要承诺「通道自动 revoke」。

## 12. 下游影响（实测 grep，行号可核）

| 下游 | 证据 | 要改代码吗 |
|---|---|---|
| `ai-tool` | `src/index.ts:30` = `export * from '@isdk/tool-rpc'`；自身 src 零 `clientId` / `.identity` 命中 | 不用。重建 dist + 版本 bump |
| `tool-electron` | `src/pubsub/electron-server.ts:130` = `clientId: sessionId.toString()`，自己生成；它的 transport 走共用流水线（`src/ipc-server.ts:60` `extends ServerToolTransport`、:192 `processIncomingCall`） | 不用。跑测试确认。要在 IPC 上装策略得先给 payload 开一个凭证字段：`src/ipc-server.ts:217` 的 `headers` 是空对象，`src/pubsub/electron-client.ts:140` 写 `clientId: ''`（契约 11 的落点） |
| `tool-event` | 它**确实**从 RPC header 取 clientId：`src/transports/pubsub/sse-server.ts:77` 的 `getSessionFromReq`；客户端侧把服务端发的 id 回写进 header（`src/event-client.ts:89-94` → 本包 `src/transports/client.ts:124-127`）。不 forward 本包 | 要：§12.1 收口 |
| `tool-rpc-fastify` | `src/fastify-server.ts:340` = `clientId: headers[RPC_HEADERS.CLIENT_ID]`；但它走共用流水线（:65 `extends ServerToolTransport`、:154 `processIncomingCall`） | 不用改那行（未装策略时透传）；要的是装配时传 `identity` + `credentialReader`。它的 `Req` 是 `FastifyRequest`（不是 `IncomingMessage`），Node 对象在 `raw._req` / `raw._res`（:345） |

### 12.1 tool-event 收口（保留它的公开面）

```typescript
import { RpcIdentityPolicy, RpcSessionIdentityPolicy, type RpcCredentialReader } from '@isdk/tool-rpc';

export type SSEIdentityPolicy = RpcIdentityPolicy<IncomingMessage>;

/** EventSource 不能设 header，所以 header 优先、退 query。这条 SSE 专属规则留在 tool-event。 */
export const sseCredentialReader: RpcCredentialReader<IncomingMessage> = readSSESessionCredential;

export const createSSEIdentity = (o?: SSETokenIdentityOptions) =>
  new RpcSessionIdentityPolicy<IncomingMessage>(o);
```

`sessionToken` 键名、`welcome` 帧、`last_event_id` 重放、resume window 留在 tool-event（事件协议的一部分）。
`SSEChannel.connect()` 的形状变化：先过 `credentialReader` 得到 `ctx.credential` 再喂 `match`；`req` 留在 `ctx.req` 当逃生口。

**收口注意事项**（改 tool-event 时逐条核）：

原实现位置（2026-10-12 实测）：`src/utils/sse-identity.ts`（172 行，`SSETokenIdentityPolicy` 在 :112）与
`src/utils/sse-channel.ts`（425 行）。它的钩子形状是 `resolve` / `issue` / `credential(clientId)` / `revoke(clientId)`
（:33 / :36 / :42 / :45），对应框架侧的 `match` / `assign` 的 id 部分 / `assign` 返回体的 `credential` / `revoke`。

1. 框架侧的类顶掉 `SSETokenIdentityPolicy` 前，逐条核 §4 四条契约对它的等价性：`ensureCredential` 幂等复用、TTL 滑动、
   `lookupIdentity` 只数出示且作废即删条目（原实现 `resolve` 已如此：`src/utils/sse-identity.ts:124-135`，
   过期/超次数就 `tokens.delete(token)`，:130）。
   **默认值不等价**：原实现 `maxUses` 默认 5（:121），框架侧默认不限（§4）→ 收口时要显式传 `maxUses: 5` 才与今天同行为。
2. `SSEChannel` 现在靠反查取凭证发 welcome 帧（`src/utils/sse-channel.ts:359` 的 `identity.credential?.(finalClientId)`）；
   框架侧无反查 → welcome 帧改在 `assign` 返回体的 `credential` 上取（框架侧不定义下发通道，契约 11）。
3. §3 第 3/4 条（`clientId === identity.id`）对 tool-event 是行为变更，排在 tool-rpc 发布之后做；它的
   三张表全部以 clientId 为 key（`clients`：`src/utils/sse-channel.ts:44`；`resumable`：同文件 :56；
   `sessions`：`src/transports/pubsub/sse-server.ts:28`），所以 `id` 必须是连接级（见 §5 的注）。
4. 它的公开面 `SSEIdentityPolicy` / `sseCredentialReader` / `createSSEIdentity` / `SSETokenIdentityOptions` 键名不变
   （四个全部换成框架侧对应类型的别名，或框架侧类的工厂），实现换成框架侧的类。
5. `getSessionFromReq`（`src/transports/pubsub/sse-server.ts:77`）直取 `req.headers[RPC_HEADERS.CLIENT_ID]` 查
   `sessions` 表：收口后改走 identity。今天它能工作，靠的是客户端把服务端发的 id 回写进 header
   （`src/event-client.ts:89-94`）——契约 3 就是把这套约定形式化。

## 13. 需要单独解释的点

正文不展开，逐条说明在对话里：

1. 为什么 A 叫 `session`：它与 `bearer` 同为**机制名**（`bearer` 是 RFC 7235 的方案名），且本包与 tool-event 已用
   `session` 指「服务端认出来的那段连接生命周期」（`src/transports/models.ts:23` 的 `CLIENT_ID` 注释、tool-event 的
   `rpc-session-token` / `sessions` 表）。它的边界：只管凭证的签发与识别这一段；「会话还活着吗」（resume window /
   在线表）在通道（§9 的 P2 `RpcSessionRegistry`），不进这个类——所以 `session` 不会长成「会话族基类」。
   扩展它不是只有继承一条路（§7：继承与替换策略并列）。
2. 策略要状态就自己持有，框架侧无存储：默认实现的续用窗口是秒级（`ttlMs=30s` / `resumeWindow=30s`），
   重启作废与「断线太久」对客户端是同一语义。因此秒级窗口下 sticky session 通常比共享存储便宜；
   要共享/持久化就走 `registry` 这个口子。
3. 为什么 `match` 与 `assign` 不合成一个钩子。
4. 为什么身份只落 `ctx.identity` 一处、不平铺。
5. 私有 header 走部署自己的 reader，内置 reader 只读标准字段（nginx / 鉴权代理 / 浏览器扩展 / 现成 SDK 零特殊配置）。
6. 为什么 `credential` 只出现在 `assign` 返回值（签发与交付合成一次返回，反查消失）；以及为什么下发通道
   归策略、框架侧不定义凭证 header（EventSource 读不到响应头，一个 header 名约不下所有协议）。
7. 为什么 `RpcCredentialSource` 不是策略（判定身份是接收方的动作）。
8. 为什么 `name` 必须声明成 `string`（TS2416，已编译实测）。
9. 为什么 `clientId` 不扩成 `string | RpcIdentity`（wire 字段与下游 Map 的 key，对象 key = 引用相等）。
10. 为什么 `maxUses` 默认不限（计数单位是 `match` 调用次数，HTTP 是每请求一次；默认 5 等于「第 6 个请求鉴权失败」）。
11. 为什么三个钩子统一 `await`（验签要拉 JWKS、查库；同步实现不受影响）。
12. 为什么 bearer 侧不设 `assignAnonymous`：匿名不是一个身份种类，它是 `assign` 在没有效凭证时的产物。
13. 为什么内置登记表只定「先 `prune`、仍满不发」这一条容量行为：LRU 之类是策略选择，不是登记表的必要功能，
    走 `registry` 这个口子由开发者实现。

## 14. 落地清单

1. 先改名单：`test/browser-entry.test.ts` 加 `EXPECTED_IDENTITY_TYPES`，它会先红，再动代码。断言要写成**运行时 import 两个入口**（照 :199 的 `should export only the address helpers a transport needs`：`await import('../src/browser')` 与 `'../src/index'`，逐个 `typeof` 断言）——文件末尾那两条 dist 断言在未构建时会 skip，不会红。11 个符号：
   `RpcIdentity`、`RpcIdentityContext`、`RpcCredentialReader`、`RpcCredentialSource`、`RpcIdentityPolicy`、
   `RpcCredentialRegistry`、`RpcSessionIdentityPolicy`、`RpcSessionIdentityOptions`、`RpcInProcessCredentialRegistry`、
   `RpcBearerPolicy`、`RpcVerifiedCredentialOptions`。
2. 两个入口显式导出且一致：`src/transports/index.ts`、`src/transports/browser.ts`。
3. 单测要钉住：§3 十一条契约、§4 登记表四条契约、§7 两个继承例子、§8 自定义策略例子（能编译且行为对）。
   P1b 另加两条回归：**未装策略时 header 透传与今天逐字节一致**（照 `src/transports/http-server-regressions.test.ts` 的写法）、
   **装了策略后 401 的响应形状**（`RpcError('Unauthenticated', 401, 'unauthenticated')` → `code: 401` +
   `status: 'unauthenticated'`，见 `src/transports/models.ts:182`（`RpcError` 类，构造签名在 :189）；经 `server.ts:275-277` 的顶级防护
   映射成响应 `status: 401` + `error.status: 'unauthenticated'`）。登记表加一条内存有界（大量闲置身份后条目数有界）。
4. 检查：`./node_modules/.bin/tsc --noEmit -p tsconfig.release.json`、`./node_modules/.bin/tsc --noEmit -p tsconfig.json`、
   `npx vitest run`、`npx tsup --dts --dts-resolve`。
5. 文档：身份策略**单开一节**（服务端运行时），不进 `src/transports/README.cn.md` §8.0 那张传输层 helper 表
   （那张表保持两个文件）；`README.md` / `README.cn.md` 加使用者章节
   （先写两个默认实现与 §6 差异表，再写策略接口）；`AGENT.md` 同步。不写 tool-event 的事件协议细节。
6. 基线（2026-10-12 实测）：`tsc -p tsconfig.release.json` exit 0；`tsc -p tsconfig.json` exit 0；
   `vitest run` 44 文件 / 539 测试通过。

---

## 15. 补钉（2026-10-12 复盘：401 进枚举 + bearer 单测 + 端到端）

三条缺口，按同一顺序补（先钉名单/测试，再动代码）：

1. **401 进枚举**：`RpcStatusCode.UNAUTHENTICATED = 401`（`src/transports/models.ts:92`）。
   之前 `reject` 里是裸数字 401，`dispatcher.handleError` 的自动状态串补全也只到 400/404/409。
   现在 `identity-bearer.ts:114` 用枚举，`dispatcher.ts:352` 对 401 自动补 `unauthenticated`。
   枚举只是常见码语义对照表、不是闭集：策略要 403 就直接写 403（见 `identity-bearer.test.ts` 的 HmacPolicy 例子）。
2. **`src/transports/identity-bearer.test.ts`**（15 条）：默认实现 B 自身的契约——`allowAnonymous` 两态、
   「verify 不认」与「无凭证」同形状、verify 可 async、verify 抛错不被吞成 undefined、
   `ctx.credential` 与策略 reader 的优先级、`assign` 返回体不带 credential、三个 `protected` 覆写点、
   策略无状态可复用。
3. **`test/identity-e2e.test.ts`**（16 条）：真 socket / 真消息总线的端到端，钉客户端能观察到的东西：
   401 到手上是 `RPC Error [401]` + `code: 401` + `status: 'unauthenticated'`，且业务工具零调用；
   合法 Bearer 下业务侧 `ctx.identity` 就是 `verify` 的产物；`ClientTools.loadFrom()` + `run()` 全栈走通；
   会话凭证经响应头下发后——**下发与取回必须成对配**（只写 `res.setHeader` 不配 `credentialReader`，
   默认 reader 读不到私有 header，每次都是新身份）；Mailbox 的 `MailMessage.headers` 共用同一个默认 reader。
   当时还钉了一条边界：**发现端点不经身份管道**（`addDiscoveryHandler` 的 GET 根路径由物理路由直接回），
   `allowAnonymous: false` 也拦不到「列工具」。该边界已在 §16 收口（那一轮先钉住当时的行为，下一轮改行为）。

新基线（2026-10-12 实测）：`tsc -p tsconfig.release.json` exit 0；`tsc -p tsconfig.json` exit 0；`eslint .` exit 0；
`tsup --dts --dts-resolve` exit 0（`UNAUTHENTICATED = 401` 进 dist 的 d.ts，运行时 `RpcStatusCode[401] === 'UNAUTHENTICATED'`）；
`vitest run` 48 文件 / 605 测试通过。

---

## 16. 逐 API 的认证判定与内置端点（2026-10-12 第二轮）

上一轮的 `allowAnonymous` 是策略实例上的一个静态布尔，**全 transport 一刀切**：要么所有 API 都允许匿名，
要么连「列工具」都得先认证。两个问题：

1. 粒度不够——没有「这个 API 必须认证、那个可以匿名」的写法。
2. 发现端点不在管道内——想统一认证时它是个洞。

**定下的机制（不在 transport 上开逐 API 开关）**：

- 策略要能**看到当前请求在调哪个 API**，才能自己判。所以 `RpcIdentityContext` 加寻址结果与备料：
  `toolId` / `act` / `resId` / `prefix` / `apiUrl` / `tool` / `builtin`（§2）。`tool` 是注册表里那个实例，
  按 dispatcher 的解析顺序取（前缀 claim 的 registry → transport 自己的 → dispatcher 的）；取不到就是
  `undefined`，**不在身份这一步报 404**（那是 dispatcher 的活）。框架不读 `tool` 的任何字段。
- 判定入口复用已有的那个选项：`allowAnonymous: boolean | ((ctx) => boolean)`（§5）。布尔 = 一刀切（旧行为不变），
  谓词 = 逐请求/逐 API。工具注册级元数据直接读 `ctx.tool` 上自带的字段（继承 `ServerTools` 加字段即可），
  字段名是部署与业务的私有约定。
- **不加 `requireIdentity` 这类字段**（路由声明上、工具注册上都不加）：它僵硬，且与策略谓词重复——
  开关一旦落在 transport 或注册表上，就等于框架开始解释业务元数据。要「这条前缀必须认证」，
  策略读 `ctx.prefix` 自己判。
- 这是**认证**（要不要凭证），不是**授权**（谁能调哪个工具）。§10 的分工不变：授权仍在 `validateRpcRequest` 与业务。

**逐工具 / 逐 API 的认证判定：字段是数据，生效靠谓词**：

上面那个 `authScope` 例子容易被读成「工具上写个字段框架就认」，这里把边界钉清：

- **工具上的字段本身不产生任何认证效果。** 框架不读 `tool` 的任何字段（上面已写），所以注册时随手写一个
  `allowAnonymous: true` 不会有任何作用——它和 `authScope` / `isApi` 一样只是数据。
- **生效靠策略谓词读它。** 约定一个字段名，再在策略里读：

```ts
new RpcBearerPolicy({
  verify,
  // 默认必须认证；工具注册时显式 allowAnonymous: true 才放行匿名
  allowAnonymous: (ctx) => (ctx.tool as any)?.allowAnonymous === true,
})
```

- **字段名与 `allowAnonymous` 同名的代价**：与策略选项 `allowAnonymous` 撞名，读代码的人容易以为两者有联动
  （其实没有）。不介意就沿用（上面那个例子，也是测试钉住的写法）；想避开歧义就换个名，
  比如 `publicAccess: true` 配 `allowAnonymous: (ctx) => (ctx.tool as any)?.publicAccess === true`。
- **`ctx.tool` 可能是 `undefined`**（工具还没寻到 / 不在该前缀注册表里）。谓词要按 `undefined` 明确表态：
  上面那种「只有显式 true 才放行」的写法，寻不到工具就是拒绝（默认公开）；反过来写
  `(ctx.tool as any)?.requireAuth !== true` 则是寻不到工具就放行（默认公开）。两种都合理，但必须选一个。
- **布尔与谓词不能同时表达逐工具**：`allowAnonymous: false` 是一刀切拒绝，不会去看工具字段；
  要逐工具就必须传谓词。反过来 `allowAnonymous: true` 是一刀切允许，凭证不认也放行。
- 这个选项**只在 bearer 策略上有**：`RpcSessionIdentityPolicy` 没有拒绝路径（凭证不认就是另起新会话），
  要逐工具决定认不认，自己实现 `RpcIdentityPolicy`（§10）。

测试：`src/transports/identity-server.test.ts` 的「工具上写 `allowAnonymous: true` 本身不生效」与
「谓词读 `ctx.tool` 上的字段才生效」两条；`test/identity-e2e.test.ts` 的「逐 API 的认证判定」是同一模式的端到端版。

**发现端点：它是框架自有的一个内置 API，走同一条判定**（本轮的实现方式已被 §17 取代，结论不变）：

- 当时响应仍由物理路由直接回（不经 `dispatcher`），只是在回之前多一步 `resolveBuiltinIdentity('discovery', …)`。
  **第三轮删了这类内置端点专用入口**：发现端点现在就是普通工具，走 `processIncomingCall` 同一条路（§17）。
- 判定与业务侧同一条：`match` → 必要时 `assign`，**只有策略抛错才是 401**（与契约 1 一致：拒绝必须抛）。
  错误封包走 `sendPipelineError`（`src/transports/server.ts:289`），取码规则与顶级防护同一套，
  所以客户端 `loadApis()` 拿到的是带 `code` / `status` 的 RPC 错误，不是裸 500。
- **默认仍公开**：不装策略逐字节不变；装了策略，要不要认由谓词定（当时是 `ctx.builtin === 'discovery'`，
  现在是 `ctx.toolId === 'rpcApis'`）。全局 `allowAnonymous: false` 会连发现一起拦——那是部署显式选了「一刀切」的结果，不是框架偷偷改默认。
- 客户端侧配套：`ClientTools.loadFrom()` 把类级 `fetchOptions`（凭证就在那）合进发现调用
  （`src/client-tools.ts:109`），否则发现端点一开认证就取不到工具清单。

测试：`test/identity-e2e.test.ts` 的「逐 API 的认证判定」（同一策略实例下未标记的 API 匿名可进、带 `authScope`
的必须凭证、发现端点在谓词里单独放行）与「策略看到的备料」（`toolId` / `act` / `resId` / `tool` 字段）。

---

## 17. 发现端点收进流水线：内置工具 `rpcApis` + 路由表（2026-10-12 第三轮）

§16 把发现端点接上了身份判定，但它是靠两个专用入口接的（`resolveBuiltinIdentity` + `sendPipelineError`），
而且响应仍由物理路由直接回。后果：它不过 `validateRpcRequest`、不吃超时、不进 tracker，
`ctx.tool` 对它是 `undefined`，`ctx.builtin` 也就需要一个自己的字段。本质上是「内置端点有特权通道」。

**定下的机制：内置端点没有特权通道，它就是普通工具 + 普通路由行**：

- **内置工具 `rpcApis`**（`src/transports/rpc-apis.ts`，`RpcApisResource extends ServerTools`，不声明自己的
  `timeout`，因此与业务工具同受 `globalTimeout` 管）：
  与 `rpcTask` 同在一个 `systemRegistry`，由 `RpcServerDispatcher` 自动装载。它不持有清单，
  只从 `ctx.registry` 拿**本次命中前缀**的注册表，所以多前缀多注册表时各列各自的。
  id 常量 `RPC_APIS_TOOL_ID` 在 `models.ts`（客户端要用它但不能把服务端工具类带进浏览器包）。
- **路由表**（`ServerToolTransport.addRoute()` / `getRouteTable()` / `matchRouteEntry()`）：每个前缀自带三行内置声明——
  `GET 前缀根`、`act: 'list'`、`act: 'get'`（前两者 HTTP 与 Mailbox 各自命中，互不抢）。它们不是特权开关：
  第三方用同一个 `addRoute()` 写同一路径同条件就能换掉。`path: ''` 与 `'/'` 同义；`/x` 与 `/x/` 默认同义
  （`strictTrailingSlash: true` 才分两条）；`when.method` 声明侧大小写不敏感（存进表时归成大写，
  否则 `{ method: 'get' }` 是一条永不命中的声明，也替换不了内置行）。
- **注册表分层真正参与 dispatch**：`requestRegistry(rpcReq)` 把「前缀 claim 的 registry → transport 自己的 →
  dispatcher 的 → 系统保留」叠成一个 `get(toolId)` 视图交给 dispatcher。修了之前的半成品：`mount(RegB, '/v2')`
  会把 `/api` 也改指向 RegB。解析顺序与 `resolveRouteTool` 同一套，所以策略看到的 `tool` 就是真会被调的那个。
- **旧 API 降级为兼容外壳（已标 @deprecated）**：`addDiscoveryHandler(apiUrl, handler)` 仍可用，它只把 handler 挂成该前缀的
  `rpcApis` 实现（`requestRegistry` 里那一步），不再生成第二条物理路由；首次调用会经 `warnDiscoveryDeprecated()`
  打一次迁移提示（进程级 flag，不刷屏）。`resolveBuiltinIdentity` /
  `ctx.builtin` 删除；`sendPipelineError` 保留但只作为顶级防护的出口（不再是内置端点专用）。
- **客户端**：`loadApis()` 发 `toolId: 'rpcApis'`；对不支持它的旧服务端（404）回退到空 `toolId`，
  旧行为不变。

**对策略的影响**：`ctx.toolId === 'rpcApis'` 就是以前的 `ctx.builtin === 'discovery'`；`ctx.tool` 现在对发现
请求也能解析到实例。`allowAnonymous` 默认值不变（公开），所以不写谓词的部署逐字节不变。

测试：`src/transports/route-table.test.ts`（25 条：路由表归一/覆盖/最长前缀/内置行/注册表分层）、
`test/discovery-e2e.test.ts`（15 条：HTTP 8 条 + Mailbox 7 条，发现走完整流水线——身份、`validateRpcRequest`、
`globalTimeout`、多前缀各列各自清单、旧客户端 404 回退、`addDiscoveryHandler` 兼容外壳）、
`test/identity-e2e.test.ts`（谓词里 `ctx.toolId === 'rpcApis'`）。

顺带修的一处丌齐：`MailboxServerTransport.addRpcHandler` 以前丢掉 `options.registry`（基类的
`RouteClaimOptions` 有它），现在转给 `claimRoute`，所以 mailbox 也能按前缀挂注册表。

新基线（2026-10-12 实测）：`tsc -p tsconfig.json` 与 `tsc -p tsconfig.release.json` exit 0；`eslint .` exit 0；
`vitest run` 50 文件 / 652 测试通过；`tsup`（含 `--dts --dts-resolve`）exit 0；
`typedoc --plugin typedoc-plugin-markdown` 0 errors（16 条外部符号链接 warning，与本轮无关）。

---

## 18. 凭证来路的权威：reader 说了算（issue #3）

`ctx.credential === undefined` 以前分不开两种情况：「transport 的 reader 读了，这个请求没带我要的凭证」
与「没人读过（策略单独用 / 测试里直接 `match`）」。`RpcBearerPolicy` 因此写成了
`ctx.credential ?? this.readerOf()(ctx.req)`——reader 拒读后它回头自己读 `authorization`。

后果：部署的 `credentialReader` 不是权威。鉴权代理拓扑（只认代理注入的 `x-proxy-token`）下，
一个绕过代理、直接递 `Authorization: Bearer <valid>` 的请求能拿到身份——部署明确选择不信的
凭证来路仍被用了。

**定下的机制**：

- `resolveRequestIdentity` 备 `ctx.credential` 的同时标 `ctx.credentialRead = true`，两种情况从此可分。
- `RpcBearerPolicy.readCredential()` 三段：取到了就用；`credentialRead` 且没取到→默认不自己读；
  没人读过→退策略自己的 `credentialReader`（策略单独用这条路保留）。
- 要「只认客户端」那种拓扑就显式写开关：`fallback: 'none'`（默认，reader 权威）| `'authorization'`
  （忽略 transport 的 reader，按标准 `authorization` 再读一次）。两种拓扑都合法，所以它是选项而不是隐式行为。
- 默认 `'none'` 不带兼容包被：`identity` 在 1.1.0 后才引入、尚未发布。

测试：`src/transports/identity-bearer.test.ts`（reader 已读且无凭证 → 401，`verify` 零调用；
`fallback: 'authorization'`  opt-in 生效）、`test/identity-e2e.test.ts`（`authorization` 里放**能过 verify**
的值，这样 401 只能来自 reader 权威——旧断言用了一个无效 token，钉不住契约）。
