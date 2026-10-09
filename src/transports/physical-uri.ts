/**
 * 物理底座的 canonical URI —— 也就是 transport 的「声明身份」。
 *
 * 需要的是**一个 URI 作为唯一标识**：scheme 不是额外加的前缀，而是该 URI 自带的
 * 部分（`http://localhost:3000`、`mailbox://api@isdk.com` 本来就是 URI）。只有当
 * transport 根本没有 URL 表示时（unix socket 只写在 listen 参数里、进程内总线、
 * 共享的 in-process 实例），才需要**造**一个 URI 作为代替。
 *
 * 归一化规则（只作用于声明身份，不改动 apiUrl 本身）：
 *  - 直接用 WHATWG URL 改写后序列化，不手拼字符串（scheme/host 小写、IDN、IPv6 括号、
 *    userinfo 都由 URL 负责）
 *  - 去掉 path / query / hash（物理底座只到 authority）；URL 会把 special scheme 的 path
 *    补成 '/'，所以额外去一个尾斜杠
 *  - 默认端口由 URL 自己丢弃（实测 `http://h:80` 与 `http://h` 同 key）；比较时再由
 *    parsePhysicalUri 按 http/ws → 80、https/wss → 443 补齐
 *  - 回环别名（localhost / 127.0.0.1 / [::1]）统一为 `localhost`
 *  - 通配监听（0.0.0.0 / :: / [::]）统一为 `*`（实测 `*` 是合法 host，能写回 hostname）
 *  - unix socket 归一为 `unix:<path>`：`unix:` 之后按 URI 规范处理——**先按段
 *    percent-encode，再进 URI；要原值就 decode**（`unixSocketPath`）。词法归一
 *    （折叠 `//`、去尾斜杠、消 `.` / `..`）在**已编码**空间做，所以 `/` 只是分隔符，
 *    段内的 `%2F` 是字面斜杠，不会被当分隔符（见 `unixSocketUri`）
 *  - 其余无 authority 的 URI 与解析不了的字符串原样保留
 *
 * 另外提供「显式 bind 参数 → 声明身份」的改写（withBindOptions /
 * physicalUriFromBind）：`start({ host, port, path })` 是调用方声明的绑定，
 * 不是内核观测，所以它必须进入 key（见下）。
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const WILDCARD = new Set(['0.0.0.0', '::', '[::]', '*']);
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'ws:': '80', 'https:': '443', 'wss:': '443' };
/** host/port 有意义的 scheme；其余（unix:、mem:、fastify://…）不能按 authority 改写。 */
const ADDRESSABLE = new Set(['http:', 'https:', 'ws:', 'wss:']);
const UNIX_SCHEME = 'unix:';
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** 通配 authority 的表示（`http://*:3000`）。 */
export const WILDCARD_HOST = '*';

export interface PhysicalUri {
  /** 含冒号的 scheme，如 `http:`；opaque 身份为 undefined */
  scheme?: string;
  /** 归一化后的 host；通配为 `*`；opaque 身份为 undefined */
  host?: string;
  /** 端口字符串，已按 DEFAULT_PORTS 补齐；两者都没有时为空串 */
  port?: string;
  /** 该身份是否监听通配地址（覆盖任意 host） */
  wildcard: boolean;
  /** 无法按 authority 解析（unix socket、进程内实例标识等） */
  opaque: boolean;
}

/** host 归一：通配 → `*`，回环别名 → `localhost`，其余小写原样。 */
function canonicalHost(host: string): string {
  const h = host.toLowerCase();
  if (WILDCARD.has(h)) {return WILDCARD_HOST;}
  if (LOOPBACK.has(h)) {return 'localhost';}
  return h;
}

/** 只保留 scheme + authority（special scheme 的 URL 会把 path 补成 '/'，额外去掉）。 */
function toAuthorityOnly(url: URL): string {
  url.pathname = '';
  url.search = '';
  url.hash = '';
  const out = url.toString();
  return out.endsWith('/') ? out.slice(0, -1) : out;
}

/** 把 apiUrl（或任何带 scheme 的字符串）归一化为 canonical 物理 URI。 */
export function canonicalPhysicalUri(apiUrl: string): string {
  if (!apiUrl) {return apiUrl;}
  // unix: 先走词法通道，不能先过 URL（会把真实 socket 路径改写，见上）
  if (/^unix:/i.test(apiUrl)) {return unixSocketUri(apiUrl);}
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    // 不是绝对 URL（例如裸 path `/api`）：没有 authority 可归一，原样交给调用方兜底
    return apiUrl;
  }

  const hostname = url.hostname.toLowerCase();

  // 无 authority（mailto:…、urn:…）：没有 host/port 可归一（unix: 已在上面走词法通道）
  if (!hostname) {return url.toString();}

  // 只改 host：userinfo 属于身份的一部分（mailbox://api@isdk.com 里的 api@ 不是 host），
  // port / IDN / IPv6 括号都交给 WHATWG URL 自己处理，不手拼。
  if (WILDCARD.has(hostname) || LOOPBACK.has(hostname)) {
    url.hostname = canonicalHost(hostname);
  }

  // 物理底座只到 authority，清掉 path/query/hash。
  return toAuthorityOnly(url);
}

/**
 * 段内编码：`/` 之外的字符一律按 URI 组件规则转义（空格→`%20`、`#`→`%23`、
 * `?`→`%3F`、字面 `%`→`%25`、非 ASCII→UTF-8 百分号序列）。`encodeURIComponent`
 * 会把 `/` 编成 `%2F`，而这里先按 `/` 切段再编，所以 canonical 形式里出现的 `%2F`
 * 只可能是**段内字面斜杠**，永远不会是分隔符——两者可区分。
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * 段内解码。容错处理字面 `%`：`/tmp/%.sock` 这种文件名里 `%` 不是合法转义序列，
 * 直接 `decodeURIComponent` 会抛 URIError（实测），先把裸 `%` 当 `%25` 再解。
 */
function decodeSegment(segment: string): string {
  return decodeURIComponent(segment.replace(/%(?![0-9a-fA-F]{2})/g, '%25'));
}

/** 把裸文件系统路径按段编码成 URI path（`/` 保留为分隔符）。 */
function encodePath(socketPath: string): string {
  return socketPath.split('/').map(encodeSegment).join('/');
}

/**
 * 把 socket 路径（或已有的 `unix:` URI）归一为 canonical `unix:<path>`。
 *
 * 走 URI 规范：**入参先按段 percent-encode，再进 URI；需要原值时 decode**。
 * 关键是把编码做在进 URI 之前——直接把裸路径喂给 `new URL()` 不是编码（`%` 本身
 * 已是转义字符，WHATWG 对非法序列原样保留），于是往返不是单射（均实测）：
 *  - `/tmp/a b.sock` 与 `/tmp/a%20b.sock` 是两个不同文件，都得到 pathname
 *    `/tmp/a%20b.sock` → 塌成同一个 key（误报冲突、还会复用错 socket）。
 *    先编码则分别是 `a%20b.sock` 与 `a%2520b.sock`，可区分，且 decode 各自还原
 *  - `#` / `?` 在 parse 阶段是分隔符：`unix:/tmp/a#b.sock` 的 pathname 只剩 `/tmp/a`，
 *    那不是编码、无从 decode。先编码则成 `%23` / `%3F`，parse 后仍在 pathname 里
 *  - 字面 `%` 让 `decodeURIComponent` 抛 URIError；先编码成 `%25`，decode 时是合法序列
 *
 * 词法归一（折叠 `//`、去尾斜杠、消 `.` / `..`）在**已编码**空间做：`/` 只作分隔符，
 * `%2F` 留在段内当字面斜杠。`.` / `..` 按 decode 后的值判定（`%2E` 也是 dot segment，
 * 与 URL 规范一致）。
 *
 * 不变量：`unixSocketPath(canonical) === 实际 listen 的 socket 路径`，且
 * `unixSocketUri(unixSocketUri(x)) === unixSocketUri(x)`。
 * 入参没有 `unix:` 前缀时按**裸文件系统路径**理解（`start({ path })` 给的就是这个）；
 * 带 `unix:` 前缀时按 URI 理解，其后已是 percent-encoded。
 * 已经是别的 scheme（含 Windows 盘符）时原样返回，不会被改写成 `unix:`。
 */
export function unixSocketUri(socketPath: string): string {
  if (!socketPath) {return socketPath;}
  const isUnix = /^unix:/i.test(socketPath);
  if (!isUnix && SCHEME_RE.test(socketPath)) {return socketPath;}
  // unix: 之后按 URI 已是编码形式；裸路径先按段编码
  const encoded = isUnix ? socketPath.slice(UNIX_SCHEME.length) : encodePath(socketPath);

  const absolute = encoded.startsWith('/');
  const segments: string[] = [];
  for (const seg of encoded.split('/')) {
    if (!seg) {continue;}
    const literal = decodeSegment(seg);
    if (literal === '.') {continue;}
    if (literal === '..') {
      const last = segments[segments.length - 1];
      if (last && decodeSegment(last) !== '..') {segments.pop();}
      else if (!absolute) {segments.push(seg);}
      continue;
    }
    // 重新编码一次：把 `%2e` 这类等价写法收成唯一形式，保证 canonical 稳定
    segments.push(encodeSegment(literal));
  }
  const path = `${absolute ? '/' : ''}${segments.join('/')}`;
  return `${UNIX_SCHEME}${path || (absolute ? '/' : '.')}`;
}

/**
 * 从 canonical `unix:` URI 取回可直接 listen 的 socket 路径（按段 decode，`/`
 * 仍是分隔符，段内 `%2F` 还原成字面斜杠）；不是 unix 身份时返回 undefined。
 */
export function unixSocketPath(uri: string): string | undefined {
  if (!uri || !/^unix:/i.test(uri)) {return undefined;}
  const encoded = unixSocketUri(uri).slice(UNIX_SCHEME.length);
  const absolute = encoded.startsWith('/');
  const segments = encoded.split('/').filter(seg => seg !== '');
  if (!segments.length) {return absolute ? '/' : '.';}
  return `${absolute ? '/' : ''}${segments.map(decodeSegment).join('/')}`;
}

/** `start()` / transport options 里的显式 bind 参数。 */
export interface BindOptions {
  host?: string;
  /** `0` 表示由内核挑端口，属于观测而非声明，不参与 key。 */
  port?: number | string;
  /** unix socket 路径（Fastify 用 path，Node 用 path/socketPath）；指定 port 时被忽略。 */
  path?: string;
  socketPath?: string;
  socket?: string;
}

function bindPort(port?: number | string): string | undefined {
  if (port === undefined || port === null || port === '') {return undefined;}
  const p = String(port);
  return /^\d+$/.test(p) && p !== '0' ? p : undefined;
}

/** 字符串是否带 URI scheme（`http:`、`mailbox:`、`C:` 等）。 */
export function hasUriScheme(value: string): boolean {
  return SCHEME_RE.test(value || '');
}

/**
 * 从显式 bind 参数**造**一个声明身份，供 apiUrl 没有 URL 表示的 transport 用
 * （裸 path 前缀、只写在 listen 参数里的 socket）。返回 undefined 表示信息不够：
 * 既没有 socket，也没有可用端口（`port: 0` 是“由内核挑”，属于观测，不能进 key）。
 * host 未指定时按通配 `*`：通配覆盖任意具体 host，宁可多报冲突也不漏报。
 */
export function physicalUriFromBind(options?: BindOptions): string | undefined {
  if (!options) {return undefined;}
  const socket = options.path ?? options.socketPath ?? options.socket;
  // 声明了 socket 就以它为准：底座是那个文件，与 port 无关。port + path 同时给出
  // 本身就是矛盾输入，这里让声明优先，并与各 transport 的 _start 保持同一优先级
  // （否则身份与真实监听会错开，审计就不准）。
  if (socket) {return unixSocketUri(String(socket));}

  const port = bindPort(options.port);
  if (!port) {return undefined;}
  let url: URL;
  try {url = new URL(`http://${options.host ? canonicalHost(options.host) : WILDCARD_HOST}`);} catch {return undefined;}
  url.port = port;
  return toAuthorityOnly(url);
}

/**
 * 用显式 bind 参数改写已有声明身份的 authority。
 * socket 声明优先于 host/port（与 physicalUriFromBind 同一优先级）。
 *
 * 为什么 bind 参数要进 key：`start({ port: 3001 })` 是调用方**声明**的绑定，
 * 与 apiUrl 冲突时 apiUrl 才是过时的那一个——不改写就会把身份停在旧端口上，
 * 对真实底座漏报、对旧底座过报冲突。反之 `port: 0`（内核挑端口）属于观测，
 * 不改写，key 跨 start 边界仍然稳定。
 *
 * 返回 undefined 表示没什么可改写（无 bind 参数，或 base 不是按 authority
 * 寻址的 scheme），调用方沿用 apiUrl 派生的身份。
 */
export function withBindOptions(base: string, options?: BindOptions): string | undefined {
  const socket = options?.path ?? options?.socketPath ?? options?.socket;
  if (socket) {
    // 监听 unix socket：底座就是那个 socket 文件，host/port 不再相关
    return unixSocketUri(String(socket));
  }

  const port = bindPort(options?.port);
  const host = options?.host;
  if (!port && !host) {return undefined;}

  let url: URL;
  try {url = new URL(base);} catch {return undefined;}
  if (!ADDRESSABLE.has(url.protocol.toLowerCase()) || !url.hostname) {return undefined;}

  if (host) {url.hostname = canonicalHost(host);}
  if (port) {url.port = port;}
  return toAuthorityOnly(url);
}

/**
 * 把 host 换成通配标记（`*`），其余部分不动。同样走 URL，不手拼。
 * 用于「声明的 host 并不是实际绑定的 host」的 transport（见 HttpServerToolTransport）。
 */
export function withWildcardHost(uri: string): string {
  let url: URL;
  try {url = new URL(uri);} catch {return uri;}
  if (!url.hostname) {return uri;}
  url.hostname = WILDCARD_HOST;
  const out = url.toString();
  return out.endsWith('/') ? out.slice(0, -1) : out;
}

/** 解析 canonical 物理 URI；非 URL 形式返回 opaque 描述。 */
export function parsePhysicalUri(uri: string): PhysicalUri {
  if (!uri) {return { wildcard: false, opaque: true };}
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { wildcard: false, opaque: true };
  }
  const scheme = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  if (!hostname) {return { scheme, wildcard: false, opaque: true };}

  const host = WILDCARD.has(hostname) ? WILDCARD_HOST : (LOOPBACK.has(hostname) ? 'localhost' : hostname);
  return {
    scheme,
    host,
    port: url.port || DEFAULT_PORTS[scheme] || '',
    wildcard: host === WILDCARD_HOST,
    opaque: false,
  };
}

/**
 * 两个声明身份是否指向同一物理底座。
 *
 * 依据实测（两个 server 同时监听）：`0.0.0.0:3000` 与 `127.0.0.1:3000` 在两个方向上
 * 都 EADDRINUSE，`::`（双栈）同样覆盖 `127.0.0.1`；而两个**不同**的具体 host 同端口
 * 在 Linux 上可以共存。所以包含关系是单向的：通配覆盖具体 host，具体 host 之间不互斥。
 * 因此这里判定「同一底座」，但不把两者塌缩成同一个 key（塌缩会丢掉真实 host）。
 */
export function samePhysicalBase(a: string, b: string): boolean {
  if (a === b) {return true;}
  const pa = parsePhysicalUri(a);
  const pb = parsePhysicalUri(b);
  if (pa.opaque || pb.opaque) {
    // opaque 身份（unix socket、进程内实例标识）只按 canonical 字符串相等；
    // unix: 额外做路径归一，使 `unix:/run//a.sock` 与 `unix:/run/a.sock/` 同 key
    return unixSocketUri(a) === unixSocketUri(b);
  }
  if (pa.scheme !== pb.scheme || pa.port !== pb.port) {return false;}
  // 通配 authority 包含任意具体 host
  if (pa.wildcard || pb.wildcard) {return true;}
  // 两个具体 host：只有同一个 host 才算同一底座（Linux 上不同 host 同端口可共存）。
  // 注意 host 已在 parse 里归一（回环别名、大小写、默认端口），所以
  // `http://h` 与 `http://h:80`、`http://127.0.0.1:3000` 与 `http://localhost:3000` 会相等。
  return pa.host === pb.host;
}
