import { uuidv4 } from '@isdk/hash';
import { RpcError, RpcStatusCode } from './models';
import {
  type RpcIdentity,
  type RpcIdentityContext,
  type RpcIdentityPolicy,
} from './identity';

/**
 * 默认实现 B：凭证由外部签发、服务端只验证（无状态）。
 *
 * **解决什么**：认证——谁能连、连上之后他是谁，由 `verify` 决定。
 * **不解决什么**：没带凭证的连接是谁（`allowAnonymous: false` 只是拒绝，不给身份）。
 *
 * 设计文档：根目录 `IDENTITY_POLICY_DESIGN.cn.md` §5。
 */

export interface RpcVerifiedCredentialOptions {
  /** 凭证 → 身份。返回 undefined 表示不认。可以是 async。验不验、怎么验（签名 / HMAC / 查库）全在这里。 */
  verify: (credential: string, ctx: RpcIdentityContext) => RpcIdentity | undefined | Promise<RpcIdentity | undefined>;
  /**
   * 无凭证 / verify 返回 undefined 时的行为。默认 true（走 `assign`）；false 则抛 401。
   *
   * **可以是谓词**，粒度到单个 API：`allowAnonymous: (ctx) => ctx.toolId !== 'admin'`。
   * 判定材料都在 ctx 里：`toolId` / `act` / `resId`、`prefix` / `apiUrl`、`tool`（注册表里那个实例，
   * 可读它注册时带的自定义字段）。内置发现端点也是一个普通 `toolId`（`'rpcApis'`），
   * 要单独定它的认证就写 `ctx.toolId !== 'rpcApis'`。
   * 注意这是**认证**（要不要凭证）；「谁能调哪个工具」的授权仍归 `validateRpcRequest` 与业务。
   */
  allowAnonymous?: boolean | ((ctx: RpcIdentityContext) => boolean);
  /**
   * 没有效凭证时给这条连接什么身份。默认 uuid。就是 `RpcIdentityPolicy.assign` 的实现——
   * 无凭证连接的 `assign` 产物就是所谓匿名身份，不再单开一个名字。
   */
  assign?: (ctx: RpcIdentityContext) => RpcIdentity;
  /**
   * transport 的 reader 返回 `undefined` 后，策略要不要自己再读一次凭证（issue #3）。
   *
   * - `'none'`（默认）：reader 权威。它说「这个请求没带我要的凭证」，这条请求就是未认证，
   *   策略不会回头去读客户端递上来的 `authorization`——那是部署明确选择不信的凭证来路
   *   （鉴权代理拓扑：只认代理注入的私有 header）。
   * - `'authorization'`：反过来，忽略代理那条路，只认客户端自带的标准 `authorization` header。
   *
   * 两种都是合法拓扑，所以这里是个开关而不是隐式行为。默认 `'none'`：`identity` 在 1.1.0 后
   * 才引入、尚未发布，没有兼容包被。
   *
   * 注：它只管「transport 读过但没读到」这一种情况。没人读过（策略单独用 / 测试里直接
   * `match`）时默认读标准 `authorization`——那是写死的，不是可配置的来路。
   * 策略侧的凭证来路知识是**封闭**的：只有标准 bearer，不可注入自定义 reader（契约 9）。
   * 私有 header 归构造 ctx 的那一层：transport 配 `credentialReader`，裸用策略的调用方
   * 自己备 `ctx.credential`。
   */
  fallback?: 'none' | 'authorization';
}

/**
 * Bearer 凭证策略：`authorization` header（RFC 7235）→ 身份。
 *
 * 服务端不签发凭证，所以没有下发需求，也没有登记表；状态在签发方那里。
 * 可继承，覆写点一律 `protected`（设计文档 §7）。`name` 必须声明成 `string`（TS2416）。
 */
export class RpcBearerPolicy<Req = any> implements RpcIdentityPolicy<Req> {
  /** 与 'session' 对称：只写机制名（bearer 是 RFC 7235 的方案名）。必须声明成 string，见上。 */
  public readonly name: string = 'bearer';

  protected options: RpcVerifiedCredentialOptions;

  constructor(options: RpcVerifiedCredentialOptions) {
    this.options = options;
  }

  /**
   * 认：出示的凭证 → 哪个身份。签名带 Promise：`verify` 可以 async（验签要拉 JWKS、查库），
   * 框架侧统一 await。
   *
   * `allowAnonymous: false` 时，无凭证或验不过都走 `reject`（默认抛 401）——
   * 返回 undefined 是「另起新会话」，不是拒绝，两者不能混。
   */
  public async match(ctx: RpcIdentityContext<Req>): Promise<RpcIdentity | undefined> {
    const credential = this.readCredential(ctx);

    if (!credential) {
      if (this.allowAnonymous(ctx)) {return undefined;}
      return this.reject(undefined, ctx);
    }

    const identity = await this.verify(credential, ctx);
    if (!identity) {
      if (this.allowAnonymous(ctx)) {return undefined;}
      return this.reject(credential, ctx);
    }
    return identity;
  }

  /**
   * 生：没有效凭证时给这条连接的身份。返回体**不带** credential——服务端不签发凭证。
   */
  public assign(ctx: RpcIdentityContext<Req>): RpcIdentity {
    return this.options.assign ? this.options.assign(ctx) : this.assignIdentity(ctx);
  }

  /**
   * 凭证从哪里取（issue #3）。
   *
   * 三种情况必须分得开，而 `ctx.credential === undefined` 本身分不开：
   * 1. transport 的 reader 取到了 → 就用它（它懂这个协议）。
   * 2. transport 已读过但没取到（`credentialRead`）→ reader 权威：默认不再自己读，
   *    只有显式 `fallback: 'authorization'` 才按标准 header 再读一次。
   * 3. 没人读过（策略单独用 / 测试里直接 `match`）→ 默认读标准 `authorization`。
   *
   * 三条里策略能 consult 的来路只有两个：构造方递进来的 `ctx.credential`，和写死的
   * `readBearerCredential`。**没有可注入的 reader**——任意来路只能长在构造 ctx 的那一层
   * （transport 的 `credentialReader`，或裸用策略时调用方自己备 `ctx.credential`）。
   */
  protected readCredential(ctx: RpcIdentityContext<Req>): string | undefined {
    if (ctx.credential !== undefined && ctx.credential !== null) {return ctx.credential;}

    // 这里的 `readBearerCredential` 是有意写死的：策略侧只认 RFC 7235 那个标准字段，
    // 不是「再跑一遍某个 reader」。私有 header 归构造 ctx 的那一层（契约 9）。
    if (ctx.credentialRead && this.options.fallback !== 'authorization') {return undefined;}

    return readBearerCredential(ctx.req ?? { headers: ctx.headers });
  }

  /**
   * 这条请求允不允许匿名。选项是布尔就全局一刀切，是谓词就逐请求/逐 API 判定
   * （谓词拿到的就是 `match` 收到的那个 ctx，所以 `toolId` / `tool` / `prefix` 都在手上）。
   */
  protected allowAnonymous(ctx: RpcIdentityContext<Req>): boolean {
    const option = this.options.allowAnonymous;
    if (option === undefined) {return true;}
    return typeof option === 'function' ? Boolean(option(ctx as RpcIdentityContext)) : option;
  }

  /** 凭证怎么验：选项里的 `verify`。换验法（HMAC / JWKS / 查库）覆写这里。 */
  protected verify(credential: string, ctx: RpcIdentityContext<Req>): RpcIdentity | undefined | Promise<RpcIdentity | undefined> {
    return this.options.verify(credential, ctx);
  }

  /**
   * 不认的时候怎么办：默认抛 `RpcStatusCode.UNAUTHENTICATED`（契约 1：拒绝必须抛，
   * 不能用 undefined 表示）。状态串固定 `unauthenticated`，与 `dispatcher.handleError`
   * 对 401 的自动补全一致，客户端拿到的 `err.code === 401` / `err.status === 'unauthenticated'`。
   */
  protected reject(credential: string | undefined, ctx: RpcIdentityContext<Req>): never {
    throw new RpcError('Unauthenticated', RpcStatusCode.UNAUTHENTICATED, 'unauthenticated');
  }

  /** `assign` 钩子的默认实现：匿名身份 = 连接级 uuid。 */
  protected assignIdentity(ctx: RpcIdentityContext<Req>): RpcIdentity {
    return { id: uuidv4() };
  }
}

/**
 * 把 `Authorization` 的**整值**按 RFC 7235 解析成凭证（不含找 header 那一段）。
 *
 * 只有 scheme、没有 token（`Bearer` / `Bearer   `）算**无凭证**，不是字面量凭证 `Bearer`。
 * 它既不是「带前缀的 token」也不是「不带前缀的 token」；当凭证用就把「有没有凭证」
 * 变成客户端凭一个空 header 就能造出来的状态：`allowAnonymous` 谓词、审计里的
 * 「这次是否尝试认证」、自定义策略里的 `if (ctx.credential)` 全都会被骗。
 * 只拦「整值就是 scheme」这一种：`Bearer Bearer` 仍是字面量 token `Bearer`，两者必须分得开
 * （代价：不带前缀、字面量恰好是 `bearer` 的 token 无法与空 scheme 区分，这里选 scheme）。
 *
 * 对外导出是给**懂自己凭证来路**的 reader 复用这一段解析（`tool-event` 的
 * `sseCredentialReader` 就是：它自己找 header/query，解析交给这里），不是往策略里开注入口：
 * 策略侧的来路仍是封闭的（契约 9）。
 */
export function parseBearerCredential(value: string | undefined): string | undefined {
  if (value === undefined) {return undefined;}

  const trimmed = value.trim();
  if (/^bearer$/i.test(trimmed)) {return undefined;}

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return (match ? match[1] : trimmed).trim() || undefined;
}

/**
 * 内置凭证 reader：只读标准字段 `authorization`（去 `Bearer ` 前缀，RFC 7235）。
 *
 * 私有 header（鉴权代理、Electron payload、EventSource 的 query）由部署写自己的 reader，
 * 框架侧不猜。transport 的默认 reader 用它：HTTP 与 Mailbox 的原生请求都带 `headers`，
 * 所以同一个函数覆盖两者；拿不到 `headers` 时退到已归一化的 `ToolRpcRequest.headers`。
 *
 * 对外导出的判据是「下游在用」（`src/transports/README.cn.md` 的公开面判据）：
 * `tool-event` 的 SSE reader 走同一个解析，两个包对同一个请求就不会给出不同答案。
 * 它仍是「内置 reader」而非可注入口——要换来路就在构造 ctx 的那一层换
 * （transport 配 `credentialReader`，裸用策略时调用方自己备 `ctx.credential`）。
 */
export function readBearerCredential(req: any): string | undefined {
  const headers = req?.headers;
  if (!headers || typeof headers !== 'object') {return undefined;}

  // Node 的 IncomingMessage 已把 header 名小写；Mailbox 的 headers 是调用方写的，
  // 大小写不可控，所以按大小写不敏感找这一个标准字段（只此一个，私有 header 归部署）。
  let raw = headers.authorization ?? headers.Authorization;
  if (raw === undefined) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'authorization') {
        raw = headers[key];
        break;
      }
    }
  }
  if (Array.isArray(raw)) {raw = raw[0];}
  if (raw === undefined || raw === null) {return undefined;}

  return parseBearerCredential(String(raw));
}
