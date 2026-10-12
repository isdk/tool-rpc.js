import { uuidv4 } from '@isdk/hash';
import type {
  RpcCredentialRegistry,
  RpcIdentity,
  RpcIdentityContext,
  RpcIdentityPolicy,
} from './identity';

/**
 * 默认实现 A：服务端自签发会话凭证（有状态）。
 *
 * **解决什么**：连上之后不可冒充——身份由服务端在首次连接签发，客户端不能自报，
 * 别人拿不到你的会话；断线可续。
 * **不解决什么**：认证。任何人都能连上，连上就得到一个身份。
 *
 * 设计文档：根目录 `IDENTITY_POLICY_DESIGN.cn.md` §4。
 */

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
}

/** 默认值单点：30s 续用窗口、一万条容量。 */
const DEFAULT_TTL_MS = 30000;
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * 内置的最小登记表实现：一个 Map + 时间戳，存在本进程内存里。要别的介质就换 `registry`。
 *
 * 四条实现契约（设计文档 §4）：
 * - `ensureCredential` 对同一身份**幂等复用**（反复断线不累积凭证），并滑动 TTL。
 * - `lookupIdentity` 只数**出示**次数，签发不计；过期/超次数即作废、**删除该条目**、返回 undefined。
 * - 满容量时先调一次 `prune(now)`，仍满则返回 undefined（策略据此降级为「不发续用凭证」，连接照常服务）。
 * - 框架侧不驱动过期（无定时器）：清理只发生在 `lookupIdentity` 命中作废项与 `ensureCredential`
 *   满容量两处，`prune` 是给部署自己接定时任务的入口。
 */
export class RpcInProcessCredentialRegistry implements RpcCredentialRegistry {
  /**
   * 存储本体。protected 是为了子类换条目结构时不用换掉整个登记表。
   * key 是**凭证**——所以按身份找凭证要靠下面那个第二索引。
   */
  protected entries = new Map<string, { identityId: string; expiresAt: number; uses: number }>();
  /**
   * 第二索引：`ensureCredential` 按**身份**找凭证，而 `entries` 按**凭证**为 key。
   * 没有它就得线性扫（`@isdk/tool-event` 的原实现是两处线性扫，一万条时不能这么写）。
   * 幂等复用契约保证一个身份至多一张活动凭证，所以这个索引是 1:1。
   */
  protected identityIndex = new Map<string, string>();

  protected ttlMs: number;
  /** undefined = 不限出示次数（默认）。 */
  protected maxUses?: number;
  protected maxEntries: number;

  constructor(options?: { ttlMs?: number; maxUses?: number; maxEntries?: number }) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxUses = options?.maxUses;
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  public ensureCredential(identityId: string): string | undefined {
    const now = Date.now();

    // 幂等复用：同一身份反复断线不累积凭证；重新签发只滑 TTL、不重置计数
    const existing = this.identityIndex.get(identityId);
    if (existing !== undefined) {
      const entry = this.entries.get(existing);
      if (entry) {
        entry.expiresAt = now + this.ttlMs;
        return existing;
      }
      // entries 里已被别处删掉（lookupIdentity 作废）：索引跟着清
      this.identityIndex.delete(identityId);
    }

    if (this.entries.size >= this.maxEntries) {
      // 满容量的最小行为：先清一次过期项，仍满就不发（要 LRU 等淘汰策略就换 registry 实现）
      this.prune(now);
      if (this.entries.size >= this.maxEntries) {return undefined;}
    }

    const credential = uuidv4();
    this.entries.set(credential, { identityId, expiresAt: now + this.ttlMs, uses: 0 });
    this.identityIndex.set(identityId, credential);
    return credential;
  }

  public lookupIdentity(credential?: string): string | undefined {
    if (!credential) {return undefined;}

    const entry = this.entries.get(credential);
    if (!entry) {return undefined;}

    const now = Date.now();
    if (entry.expiresAt <= now || (this.maxUses !== undefined && entry.uses >= this.maxUses)) {
      // 作废即删条目：不是留在表里等 prune，否则只增不减
      this.drop(credential, entry.identityId);
      return undefined;
    }

    entry.uses += 1;
    entry.expiresAt = now + this.ttlMs;   // 每次被出示即向后滑动
    return entry.identityId;
  }

  public revoke(identityId: string): void {
    const credential = this.identityIndex.get(identityId);
    if (credential !== undefined) {this.entries.delete(credential);}
    this.identityIndex.delete(identityId);
  }

  public prune(now: number = Date.now()): number {
    let removed = 0;
    for (const [credential, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.drop(credential, entry.identityId);
        removed += 1;
      }
    }
    return removed;
  }

  /** 删条目与它的第二索引（索引只在自己那张凭证上才删，避免误删刚换上的新凭证）。 */
  protected drop(credential: string, identityId: string): void {
    this.entries.delete(credential);
    if (this.identityIndex.get(identityId) === credential) {this.identityIndex.delete(identityId);}
  }
}

/**
 * 会话身份策略：服务端在首次连接签发凭证，客户端断线后带回来续用。
 *
 * 可继承，覆写点一律 `protected`（设计文档 §7）。`name` 必须声明成 `string`：
 * 写成 `readonly name = 'session'` 会被推断成字面量类型，子类换不了 `name`（TS2416）。
 */
export class RpcSessionIdentityPolicy<Req = any> implements RpcIdentityPolicy<Req> {
  /** 与 'bearer' 对称：只写机制名。必须声明成 string，见上。 */
  public readonly name: string = 'session';

  protected registry: RpcCredentialRegistry;
  protected ttlMs: number;
  protected maxUses?: number;
  protected maxEntries: number;

  constructor(options?: RpcSessionIdentityOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxUses = options?.maxUses;
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.registry = options?.registry
      ?? new RpcInProcessCredentialRegistry({ ttlMs: this.ttlMs, maxUses: this.maxUses, maxEntries: this.maxEntries });
  }

  /**
   * 认：出示的凭证 → 哪个身份。返回 undefined = 另起新会话（框架侧接着调 `assign`），不是拒绝。
   */
  public match(ctx: RpcIdentityContext<Req>): RpcIdentity | undefined {
    const identityId = this.registry.lookupIdentity(ctx.credential);
    if (identityId === undefined) {return undefined;}
    return this.decorate({ id: identityId }, ctx);
  }

  /**
   * 生：为这条连接指派新身份。返回体带 credential（要下发给客户端的续用凭证）；
   * 登记表满容量时 `ensureCredential` 返回 undefined，降级为「不发续用凭证」，连接照常服务。
   */
  public assign(ctx: RpcIdentityContext<Req>): RpcIdentity {
    const id = this.newIdentityId(ctx);
    const identity = this.decorate({ id }, ctx);
    const credential = this.registry.ensureCredential(id);
    if (credential !== undefined) {identity.credential = credential;}
    return identity;
  }

  /** 销：丢弃该身份的凭证。P0/P1 无调用点（「一个 HTTP 请求结束」不等于「会话结束」），给通道事件预留。 */
  public revoke(identityId: string): void {
    this.registry.revoke(identityId);
  }

  /** 新身份的 id：默认连接级 uuid。要用户级 id 就覆写这里（代价见设计文档 §5 的注）。 */
  protected newIdentityId(ctx: RpcIdentityContext<Req>): string {
    return uuidv4();
  }

  /** 身份出厂后的加工点：默认原样返回。加租户 / 加属性覆写这里，不要自己访问登记表。 */
  protected decorate(identity: RpcIdentity, ctx: RpcIdentityContext<Req>): RpcIdentity {
    return identity;
  }
}
