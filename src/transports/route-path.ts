/**
 * 路由路径的共享规范化 —— 声明侧与请求侧必须走同一套规则。
 *
 * 以前有四处各自实现（基类 toPathname、Mailbox extractPath、HTTP 请求匹配内联、
 * toolId 提取），规则互不一致：claim 侧折叠 `//` 而请求侧不折叠，于是
 * `addRpcHandler('/a//b')` 声明出来的路由自己不可达；请求侧不解析 dot 段，于是
 * `/api/v2/../x` 命中 `/api/v2`，而任何规范化代理会把同一个 URL 送成 `/api/x`
 * 命中 `/api` —— 同一个请求落到哪个 transport 取决于中间件有没有规范化路径。
 *
 * 规则（只作用于 path，不碰 query，也不改写调用方手里的原始串）：
 *  - **按 `/` 切段，逐段解码**；`%2F` 不解成 `/`，否则 `/a%2Fb` 与 `/a/b` 撞车
 *  - **解析 dot 段**：`.` 丢弃、`..` 弹出上一段；判定用解码后的值（`%2e%2e` 也是
 *    dot 段，与 URL 规范一致）。`request` 模式下越出根报 400，不静默变成 `/x`；
 *    `filesystem` 模式按 POSIX 语义在根上夹住（socket 路径的 `/../x` 就是 `/x`）
 *  - **折叠重复 `/`**：`/a//b` 与 `/a/b` 是同一路由
 *  - **尾斜杠**：默认 `/foo` 与 `/foo/` 等价（`strictTrailingSlash: true` 才分成两条）
 *  - **path 大小写不折叠**：HTTP path 默认大小写敏感，折叠会串服务
 *  - **不改写原始值**：本模块只产出归一化形式，`raw` 由调用方自己留着给签名校验与审计
 *
 * 归一化形式是**编码态**（段内字符重新编码，`/` 只作分隔符），所以它可以直接当路由表
 * key；`segments` 是给 handler 的解码值，其中 `%2F` 保持编码，因此永远不会被下游再切一刀。
 * 已知边界：`%2F` 与 `%252F` 会归一到同一个段（三级转义的字面 `%2F` 无法区分）。
 */

/** 规范化失败（请求路径非法），对应 HTTP 400。 */
export class RoutePathError extends Error {
  public status = 400;
  public code = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RoutePathError';
  }
}

export interface RoutePathOptions {
  /**
   * `request`：HTTP 请求路径与路由声明，dot 段越出根报 400。
   * `filesystem`：unix socket 之类真实文件路径，按 POSIX 语义在根上夹住。
   */
  mode?: 'request' | 'filesystem';
  /** `/foo` 与 `/foo/` 是否算两条路由。默认 false（等价）。 */
  strictTrailingSlash?: boolean;
}

export interface NormalizedRoutePath {
  /** 归一化后的路径，编码态，以 `/` 开头；根为 `/`。 */
  path: string;
  /** 解码后的段（`%2F` 保持编码），给 handler 取 toolId / resId。 */
  segments: string[];
  /** 原始路径是否带尾斜杠（`strictTrailingSlash` 下用来区分两条路由）。 */
  trailingSlash: boolean;
}

/** 段内编码：`/` 之外的字符一律按 URI 组件规则转义。 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * 段内解码。
 *
 * `request` 模式严格：`%ZZ` 不是合法转义序列，调用方要写字面 `%` 就该写 `%25`，
 * 所以直接抛 URIError，由调用方翻译成 400（不是 500）。
 * `filesystem` 模式容错：`/tmp/%.sock` 是个完全合法的文件名，先把裸 `%` 当 `%25` 再解。
 */
function decodeSegment(segment: string, lenient: boolean): string {
  return decodeURIComponent(lenient ? segment.replace(/%(?![0-9a-fA-F]{2})/g, '%25') : segment);
}

/**
 * 判断是否 dot 段：按解码后的值判定（`%2e` 也是 dot 段）。
 * 解码不了的（畸形转义）按字面串处理，交给后面的 400 兜底。
 */
function dotValue(segment: string, lenient: boolean): string {
  try {
    return decodeSegment(segment, lenient);
  } catch {
    return segment;
  }
}

/**
 * 归一化一个路径（或 URL 的 path 部分）。
 *
 * 传入绝对 URL 时只取其 path 部分（scheme/authority/query 不属于路由路径）。
 * 非法转义（`%ZZ`）报 400，不落到 500。
 */
export function normalizeRoutePath(raw: string, options: RoutePathOptions = {}): NormalizedRoutePath {
  const mode = options.mode ?? 'request';
  const value = raw || '/';

  // 绝对 URL：只取 path 部分，scheme 由 WHATWG 负责（顺带把大小写归一）
  let pathname = value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      // 不是合法绝对 URL：按普通路径前缀处理
    }
  }

  // query 不属于 path；`#` 留在段内（请求目标里本就不该出现，出现就是字面字符）
  const q = pathname.indexOf('?');
  if (q >= 0) {pathname = pathname.slice(0, q);}

  // 路由前缀与请求目标都是绝对路径：`api/x` 与 `/api/x` 是同一条路由
  const lenient = mode === 'filesystem';
  const trailingSlash = pathname.length > 1 && pathname.endsWith('/');

  const segments: string[] = [];
  for (const seg of pathname.split('/')) {
    if (!seg) {continue;}                       // 折叠重复 / 与开头的 /
    const literal = dotValue(seg, lenient);
    if (literal === '.') {continue;}            // 解析掉，与规范化代理一致
    if (literal === '..') {
      if (segments.length) {segments.pop();}
      else if (lenient) { /* POSIX：在根上夹住 */ }
      else {throw new RoutePathError(`Path escapes its root: ${raw}`);}
      continue;
    }
    let decoded: string;
    try {
      decoded = decodeSegment(seg, lenient);
    } catch (e: any) {
      throw new RoutePathError(`Malformed percent-encoding in path: ${raw}`);
    }
    // 重新编码一次：把 `%2e` 这类等价写法收成唯一形式，并保证段内不出现裸 `/`
    segments.push(encodeSegment(decoded));
  }

  let path = `/${segments.join('/')}`;
  if (options.strictTrailingSlash && trailingSlash && path !== '/' && !path.endsWith('/')) {
    path = `${path}/`;
  }

  // segments 用解码值，但 `%2F` 保持编码：下游再 split('/') 也不会把一段切成两段
  const decodedSegments = segments.map(seg => {
    const literal = decodeSegment(seg, lenient);
    return literal.includes('/') ? seg : literal;
  });

  return { path, segments: decodedSegments, trailingSlash };
}

/**
 * 前缀匹配用的 key：补尾斜杠，避免 `/api` 误匹配 `/apix`。
 * 根前缀 `/` 本身就是匹配一切的前缀，不再补；已经以 `/` 结尾的前缀（
 * `strictTrailingSlash: true` 下才会出现）也不重复补。
 *
 * 注意：`strictTrailingSlash: true` 时 `/foo` 与 `/foo/` 是两条不同的**声明**，
 * 但它们的匹配 key 相同（都是 `/foo/`），所以在同一个底座上不能同时存在——
 * 第二条会被当作重复声明拒掉。开关的意义是把「等价与否」变成显式配置，
 * 而不是两侧各自实现出来的巧合。
 */
export function routeMatchKey(prefix: string): string {
  return (prefix === '/' || prefix.endsWith('/')) ? prefix : `${prefix}/`;
}

export interface RouteMatch<T> {
  /** 命中的路由表 key（匹配形式） */
  key: string;
  /** 该 key 声明的归一化前缀 */
  prefix: string;
  value: T;
}

/**
 * 最长前缀匹配。`table` 的 key 必须是 `routeMatchKey()` 产出的形式——
 * 插件只能通过本函数查表，拿不到裸串，两侧规则就没机会分叉。
 *
 * 命中条件与 `ServerToolTransport.matchedPrefix()` 同一套：路径**等于**前缀也算命中
 * （`/api` 这个请求归 `/api` 这个 claim），或落在前缀之下（`startsWith(key)`，key 已补尾斜杠，
 * 所以 `/apix` 不会误配 `/api`）。只写 `startsWith` 会漏掉「等于前缀」那种请求：调用方得先自己
 * `routeMatchKey()` 才能命中，那是个只有内部知道的约定，插件踩得到。
 */
export function matchRoute<T>(table: Map<string, T>, normalizedPath: string): RouteMatch<T> | undefined {
  let best: RouteMatch<T> | undefined;
  for (const [key, value] of table) {
    const prefix = key === '/' ? '/' : key.slice(0, -1);
    if ((normalizedPath === prefix || normalizedPath.startsWith(key))
      && (!best || key.length > best.key.length)) {
      best = { key, prefix, value };
    }
  }
  return best;
}

// Host 头、authority、回环别名——那些是 HTTP/TCP 的地址语义，不在这个模块里
// （见 socket-address.ts 的 normalizeHostAndPort / normalizeSocketAddress）。
// 本模块只管 path：切段、解码、dot 段、尾斜杠。
