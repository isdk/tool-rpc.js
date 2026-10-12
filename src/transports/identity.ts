/**
 * 身份策略：本包只回答一个问题——**这个请求是谁**。
 *
 * 这个文件是抽象层，零实现（两个默认实现在 `identity-session.ts` / `identity-bearer.ts`）。
 * 分工边界（设计文档 `IDENTITY_POLICY_DESIGN.cn.md` §1、§10）：
 * - 超时归 dispatcher，路由归 `route-path.ts`，SSRF / 全局拦截归 `RpcTransportManager.validateRpcRequest`，
 *   会话活性（「会话还活着吗」）归通道。
 * - 「谁能调哪个工具」不在策略，在 `validateRpcRequest` 或业务工具。
 * - 框架侧只调接口：不 `instanceof`、不按 `name` 匹配、不读策略内部、不缓存返回值；
 *   状态（登记表、TTL、计数器）与凭证逻辑都在策略内。
 *
 * browser-safe：不碰监听对象、不碰 `http` 模块、不 import Node 内建模块。
 */

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
 * 客户端自报的 clientId 不在这里，在 `headers[RPC_HEADERS.CLIENT_ID]`。
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
  /** 已归一化的 header 集合。 */
  headers?: Record<string, string | number | string[] | undefined>;
  /** 命中的逻辑前缀与 apiUrl：同一 transport 服务多个前缀时，策略可按前缀分租户。 */
  prefix?: string;
  apiUrl?: string;
  /**
   * 本次调用的寻址结果（transport 已解析）：工具 id / 动作 / 资源 id。
   * 内置发现端点也是一个普通工具 id（`'rpcApis'`），所以这里不需要为它开例外。
   */
  toolId?: string;
  act?: string;
  resId?: string;
  /**
   * 注册表里解析到的工具实例（`ServerTools` 那种）。解析顺序与实际分发同一套：
   * 前缀 claim 的 registry → transport 自己的 → dispatcher 的 → 系统保留；都取不到就 undefined。
   *
   * 它是**只读备料**：策略可以读注册时带的自定义字段（继承 `ServerTools` 加的字段、`isApi` / `stream` /
   * `timeout` / `description` 等）来做「这个 API 要不要认证」的判定。框架不读它的任何字段、不解释语义。
   *
   * 所以「逐工具控制认不认」要自己写谓词，字段本身不产生效果：
   * `RpcBearerPolicy({ allowAnonymous: (ctx) => (ctx.tool as any)?.allowAnonymous === true })`。
   * 注意 `tool` 可能是 `undefined`（工具未寻到），谓词要按 `undefined` 明确表态。
   */
  tool?: any;
}

/** 身份策略：凭证 → 身份。外部认证协议通过替换策略接入。 */
export interface RpcIdentityPolicy<Req = any> {
  /** 诊断用名字，出现在日志与审计里。 */
  readonly name: string;
  /**
   * 认：出示的凭证 → 哪个身份。返回 undefined = 另起新会话，不是拒绝。
   * 同步异步都可：验签要拉 JWKS、查库要 await，所以返回类型带 Promise，**框架侧一律 await**。
   */
  match: (ctx: RpcIdentityContext<Req>) => RpcIdentity | undefined | Promise<RpcIdentity | undefined>;
  /** 生：没有效凭证 → 为这条连接指派新身份。返回体可带 credential（要下发给客户端的续用凭证）。 */
  assign: (ctx: RpcIdentityContext<Req>) => RpcIdentity | Promise<RpcIdentity>;
  /** 销：会话彻底没了（流关死、通道 reset）→ 丢弃该身份的凭证。P0/P1 无调用点，给通道事件预留。 */
  revoke?: (identityId: string) => void | Promise<void>;
}

/**
 * 服务端签发凭证的登记表接口。框架侧只定义这四个方法与四条契约（设计文档 §4）：
 * 存储介质、生命周期、是否共享、淘汰策略由实现决定。
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

/**
 * 内置凭证 reader：只读标准字段 `authorization`（去 `Bearer ` 前缀，RFC 7235）。
 *
 * 私有 header（鉴权代理、Electron payload、EventSource 的 query）由部署写自己的 reader，
 * 框架侧不猜。transport 的默认 reader 用它：HTTP 与 Mailbox 的原生请求都带 `headers`，
 * 所以同一个函数覆盖两者；拿不到 `headers` 时退到已归一化的 `ToolRpcRequest.headers`。
 *
 * 包内 helper，不在 11 个公开符号里（部署要换 reader 就自己写一个）。
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

  const value = String(raw).trim();
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return (match ? match[1] : value).trim() || undefined;
}
