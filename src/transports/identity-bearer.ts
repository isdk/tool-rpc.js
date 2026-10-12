import { uuidv4 } from '@isdk/hash';
import { RpcError, RpcStatusCode } from './models';
import {
  readBearerCredential,
  type RpcCredentialReader,
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
  /** 凭证取法。默认读 authorization（去 Bearer 前缀）。 */
  credentialReader?: RpcCredentialReader;
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
    // transport 的 credentialReader 优先（它懂这个协议）；没备到 ctx 才退策略自己的 reader
    const credential = ctx.credential ?? this.readerOf()(ctx.req as Req);

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

  /** 凭证取法：选项缺省读 `authorization`（去 Bearer 前缀）。 */
  protected readerOf(): RpcCredentialReader<Req> {
    return (this.options.credentialReader ?? readBearerCredential) as RpcCredentialReader<Req>;
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
