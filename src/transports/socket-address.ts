import { defaultsDeep } from 'lodash-es';

/**
 * 本模块只回答一个问题：**这个服务监听在哪个 socket 上？** 答案始终是一个 URI 字符串
 * （`http://localhost:3000`、`unix:/run/ai.sock`），叫底座地址。它同时是底座池 key、
 * 路由归属登记 key 与 `getListenAddr()` 的返回值。
 *
 * 不叫 http-address：监听底座是 TCP socket 或 unix socket 文件，与用哪个框架无关。
 * `HttpServerToolTransport`、`FastifyServerToolTransport`、以后的 Express/Hono/WS
 * transport 都是同一个底座的不同写法，所以它们必须共用这里的规则。以前各写一遍就
 * 漂移过（socket 三个别名、默认 bind、`stop()` 后释不释放归属登记）。
 *
 * 三个时刻（listen 这个系统调用自带的，不是这里发明的）：
 * - `socketAddressFromBind()`：监听**前**，从 apiUrl + bind 参数推。`port: 0` 时端口是假的。
 * - `socketAddressFromListen()`：监听**后**，把内核观测值（`server.address()`、
 *   Fastify `listen()` 的返回值）换成同一个地址。
 * - `normalizeSocketAddress()`：两个时刻都要过的写法规范化。
 * 前两者必须算出同一个字符串，否则同一个 socket 在池里会有两个 key。
 *
 * **物理底座的所有权不在这里**：HTTP 的 `sharedServers` 池 / refCount / 最长前缀分发表
 * 留在 `http-server.ts`，Fastify 把路由交给 find-my-way、共享粒度是「同一个 fastify
 * 实例」。这里只处理字符串与参数，不碰监听对象。
 *
 * ## 拼写级规范化：只碰 scheme 无关的部分
 *
 * 需要的是**一个字符串作为唯一标识**：scheme 不是额外加的前缀，而是该 URI 自带的部分
 * （`http://localhost:3000`、`mailbox://api@isdk.com` 本来就是 URI）。只有当 transport
 * 根本没有 URL 表示时（unix socket 只写在 listen 参数里、进程内总线），才需要**造**一个
 * URI 代替。
 *  - 直接用 WHATWG URL 改写后序列化，不手拼字符串（scheme/host 小写、IDN、IPv6 括号、
 *    userinfo 都由 URL 负责）
 *  - 去掉 path / query / hash（身份只到 authority）；URL 会把 special scheme 的 path
 *    补成 '/'，所以额外去一个尾斜杠
 *  - 默认端口由 URL 自己丢弃（`http://h:80` 与 `http://h` 同 key）
 *  - unix socket 规范化为 `unix:<path>`：`unix:` 之后按 URI 规范处理——**先按段
 *    percent-encode，再进 URI；要原值就 decode**（`unixSocketPath`）。词法归一
 *    （折叠 `//`、去尾斜杠、消 `.` / `..`）在**已编码**空间做，所以 `/` 只是分隔符，
 *    段内的 `%2F` 是字面斜杠，不会被当分隔符
 *  - 其余无 authority 的 URI 与解析不了的字符串原样保留
 *
 * **不做包含关系预测**。以前这里有 `samePhysicalBase`：判定 `0.0.0.0:3000` 覆盖
 * `localhost:3000`、把非回环 host 一律塌成 `*:port`。它想预测的是 bind 冲突，而内核
 * 本来就会报 `EADDRINUSE`——预测非传递（A~B、A~C 却 B!~C，于是漏报），还把 vhost 判死
 * （两个不同 host 同端口直接报路由冲突）。现在 key 只做语法 canonical：相等就复用同一个
 * server，不相等就各自 listen，撞了由内核报错。fail fast，且不误报也不漏报。
 */

/* ---------------------------------------------------------------------------
 * TCP host 的写法规范化（HTTP 家族用）—— 不在 route-path.ts 里。
 *
 * `127.0.0.1` ≡ `localhost`、`0.0.0.0` 记成 `*`、无 scheme 的 `host:port` 补 `http://`：
 * 这些是 TCP/HTTP 的 host 概念，不是 scheme 无关的 URI 规范化，也不是 path。
 * 所以按 scheme 分派到的那个 transport 自己判（覆写 getListenAddr）。
 * ------------------------------------------------------------------------- */

/** host/port 有意义的 scheme；其余（unix:、mem:、fastify://…）不能按 authority 改写。 */
const ADDRESSABLE = new Set(['http:', 'https:', 'ws:', 'wss:']);
const UNIX_SCHEME = 'unix:';
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/** 带 authority 的写法（`http://…`）；用来区分「URL」与「裸 socket 路径」。 */
const AUTHORITY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** 回环地址的几种写法：同一个 socket，必须规范化，否则各起一个 server。 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** 通配监听的几种写法：同样是一个底座。 */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', '*']);
const WILDCARD_HOST = '*';

function normalizeHttpHost(hostname: string): string {
   const host = hostname.toLowerCase();
   if (WILDCARD_HOSTS.has(host)) {return WILDCARD_HOST;}
   return LOOPBACK_HOSTS.has(host) ? 'localhost' : host;
}

/** 只保留 scheme + authority（special scheme 的 URL 会把 path 补成 '/'，额外去掉）。 */
function toAuthorityOnly(url: URL): string {
   url.pathname = '';
   url.search = '';
   url.hash = '';
   const out = url.toString();
   return out.endsWith('/') ? out.slice(0, -1) : out;
}

/**
 * 把底座地址（或任何带 scheme 的字符串）做**拼写级**规范化：只到 authority，不碰 host 语义。
 *
 * 只在包内用：它是 `normalizeSocketAddress` 对非 http scheme（`unix:`、`mailbox://…`、
 * opaque URI）的兜底通道。地址语义归各 transport 自己，基类不替插件做通用 URI 规范化。
 */
function normalizeNativeAddress(apiUrl: string): string {
   if (!apiUrl) {return apiUrl;}
   // unix: 先走词法通道，不能先过 URL（会把真实 socket 路径改写，见上）
   if (/^unix:/i.test(apiUrl)) {return unixSocketUri(apiUrl);}

   let url: URL;
   try {
      url = new URL(apiUrl);
   } catch {
      // 不是绝对 URL（例如裸 path `/api`）：没有 authority 可规范化，原样交给调用方兜底
      return apiUrl;
   }

   // 无 authority（mailto:…、urn:…）：没有 host/port 可规范化（unix: 已在上面走词法通道）
   if (!url.hostname) {return url.toString();}

   // 只清 path/query/hash。userinfo 属于身份的一部分（mailbox://api@isdk.com 里的 api@
   // 不是 host），port / IDN / IPv6 括号都交给 WHATWG URL 自己处理，不手拼。
   // 这里不把回环别名规范化、不把通配写法塌成 `*`——那是 TCP/HTTP 的 host 语义，
   // 归对应 transport 自己的 getListenAddr() 覆写。
   return toAuthorityOnly(url);
}

/**
 * 把底座的任意写法**规范化**成同一个地址 URI：只处理写法，不预测冲突。
 *
 * 输入可以是监听前的声明（`http://localhost:3000/api`）、内核观测值
 * （`127.0.0.1:3000`、裸 socket 路径），输出只留 scheme + authority（路径、尾斜杠、
 * 默认端口全部去掉）。同一个 socket 的不同写法必须相等：`127.0.0.1` ≡ `localhost`、
 * `0.0.0.0` ≡ `*`；不同底座必须不相等（`*:3000` ≠ `localhost:3000`，否则 vhost 判死）。
 *
 * 对外导出：任何监听 TCP/unix 的 transport（如 `tool-rpc-fastify`）都要过它，两边才能
 * 对上同一个归属登记 key。名字里的 socket 指“监听底座”，不是“只能 unix”。
 */
export function normalizeSocketAddress(value: string): string {
   const raw = (value || '').trim();
   if (!raw) {return raw;}
   // 裸 path 只说路由、不说底座（`/api`）：它不是地址，不能补成 `http://api`。
   // 底座由 transport 从 bind 参数造（见 socketAddressFromBind）。
   if (raw.startsWith('/')) {return raw;}
   // unix: 地址没有 host/port 可言，走词法通道
   if (/^unix:/i.test(raw)) {return normalizeNativeAddress(raw);}

   let url: URL;
   try {
      url = new URL(AUTHORITY_SCHEME_RE.test(raw) ? raw : `http://${raw}`);
   } catch {
      return normalizeNativeAddress(raw);
   }
   if (!url.hostname) {return normalizeNativeAddress(raw);}

   const host = normalizeHttpHost(url.hostname);
   const userinfo = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : '';
   const port = url.port ? `:${url.port}` : '';
   return `${url.protocol}//${userinfo}${host}${port}`;
}

/* ---------------------------------------------------------------------------
 * Host 值归一：客户端可控输入进安全匹配之前的那一步
 * ------------------------------------------------------------------------- */

/**
 * 把 `host[:port]` 这种写法归一成可比较的形式：小写、去末尾点（`example.com.` ≡
 * `example.com`）、去默认端口（`:80` / `:443`）；IPv6 字面量只处理方括号外的部分。
 *
 * 输入是 HTTP `Host` 头那种值（`request.headers.host`）：**不含 userinfo**——RFC 9110
 * 规定 Host 头不得带 `user:pass@`。出现 `@` 时本函数不剥离也不报错，原样留在结果里；
 * 需要拒绝这种输入的是调用方。
 *
 * 为什么必须有：Host 是客户端可控输入，会被拼进 `ToolRpcRequest.apiUrl` 喂给 SSRF
 * 白名单（`url.includes(pattern)` 式匹配）。不规范化，`Host: LocalHost` 就绕过了针对
 * `localhost` 的限制。任何从客户端 host 字符串推身份的服务端 transport 都要先过这里。
 *
 * 与 `normalizeSocketAddress` 的分工：这里只管**写法**（大小写 / 尾点 / 默认端口），
 * 不把回环别名塌成 `localhost`、不把 `0.0.0.0` 塌成 `*`——那是「是不是同一个监听底座」
 * 的判定，归 `normalizeSocketAddress`。Host 头里的 `localhost` 与 `127.0.0.1` 在 vhost
 * 语义下是两个不同的入口，塌掉就把虚拟主机判死。
 */
export function normalizeHostAndPort(value: string): string {
   if (!value) {return value;}
   let host = value.trim().toLowerCase();
   // IPv6 字面量保留方括号，只处理括号外的部分
   const bracket = host.indexOf(']');
   let port = '';
   if (bracket >= 0) {
      const rest = host.slice(bracket + 1);
      if (rest.startsWith(':')) {
         port = rest;
         host = host.slice(0, bracket + 1);
      }
   } else {
      const colon = host.lastIndexOf(':');
      if (colon > 0) {
         port = host.slice(colon);
         host = host.slice(0, colon);
      }
   }

   if (host.endsWith('.')) {host = host.slice(0, -1);}
   if (port === ':80' || port === ':443') {port = '';}
   return `${host}${port}`;
}

/* ---------------------------------------------------------------------------
 * unix socket 身份：按 URI 规范编码
 * ------------------------------------------------------------------------- */

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
 * 把 socket 路径（或已有的 `unix:` URI）规范化为 canonical `unix:<path>`。
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
 * 与 URL 规范一致）。这里是**文件系统**语义，所以 `/../x` 在根上夹住成 `/x`（POSIX），
 * 不像 HTTP 请求路径那样报 400——见 route-path.ts 的 mode。
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
 * 仍是分隔符，段内 `%2F` 还原成字面斜杠）；不是 unix 地址时返回 undefined。
 *
 * 包内用（transport 拿 listen 参数时）：插件要原值的话，覆写 `getListenAddr()`
 * 时报什么就是什么，不必自己解 URI。
 */
export function unixSocketPath(uri: string): string | undefined {
   if (!uri || !/^unix:/i.test(uri)) {return undefined;}
   const encoded = unixSocketUri(uri).slice(UNIX_SCHEME.length);
   const absolute = encoded.startsWith('/');
   const segments = encoded.split('/').filter(seg => seg !== '');
   if (!segments.length) {return absolute ? '/' : '.';}
   return `${absolute ? '/' : ''}${segments.map(decodeSegment).join('/')}`;
}

/* ---------------------------------------------------------------------------
 * bind 参数：调用方**声明**这一轮怎么监听
 *
 * 它与上面的底座地址是同一件事的两半，所以放在同一个文件里：`BindOptions` 是输入，
 * `socketAddressFromBind()` 就是从它算出落在哪个地址。拆成两个文件就会两边各读一遍
 * bind —— socket 三别名一度在 4 处各写一遍，就是这么漂移出 bug 的。
 * ------------------------------------------------------------------------- */

/**
 * `start()` / transport options 里的显式 bind 参数：调用方**声明**这一轮要怎么监听。
 * 它是底座地址的输入侧，所以与 `socketAddressFromBind()` 同在一个文件。
 */
export interface BindOptions {
   host?: string;
   /** `0` 表示由内核挑端口，属于观测而非声明，不参与 key。 */
   port?: number | string;
   /** unix socket 路径（Fastify 用 path，Node 用 path/socketPath）；指定 port 时被忽略。 */
   path?: string;
   socketPath?: string;
   socket?: string;
}

/** `normalizeListenBind` 的产物：本轮实际怎么 listen；未声明的一律 undefined。 */
export interface ResolvedListenBind {
   /** 要 listen 的 socket 文件路径（已取齐写法，未做 URI 编码）。 */
   socket?: string;
   port?: number;
   host?: string;
}

/**
 * 解析 bind 参数：socket 的三个别名（`path` / `socketPath` / `socket`）、
 * **socket 优先于 host/port**、port 转成数（环境变量那种字符串也要能进来）。
 *
 * 别名与优先级只写这一处：`socketAddressFromBind()` 造声明地址时用它，transport 的
 * `_start()` 拿监听参数时也用它。两边不同一份，声明地址与真实监听就会错开（以前确实
 * 各写一遍，所以漂移过）。
 *
 * socket 优先与 Node「给了 port 就忽略 path」相反：底座必须是同一个东西。
 * **默认值不在这里定**：HTTP 未声明 host 时监听 `0.0.0.0`，Fastify 保持它自己的默认。
 */
export function normalizeListenBind(options: BindOptions = {}): ResolvedListenBind {
   const socket = options.path ?? options.socketPath ?? options.socket;
   if (socket !== undefined && socket !== null && String(socket) !== '') {
      return { socket: String(socket) };
   }

   const port = options.port === undefined || options.port === null || options.port === ''
      ? undefined
      : Number(options.port);
   const host = options.host ? String(options.host) : undefined;
   return { port, host };
}

function bindPort(port?: number | string): string | undefined {
   if (port === undefined || port === null || port === '') {return undefined;}
   const p = String(port);
   return /^\d+$/.test(p) && p !== '0' ? p : undefined;
}

/** 字符串是否带 URI scheme（`http:`、`mailbox:`、`C:` 等）。包内用。 */
function hasUriScheme(value: string): boolean {
   return SCHEME_RE.test(value || '');
}

/**
 * 从显式 bind 参数**造**一个声明地址，供 apiUrl 没有 URL 表示的 transport 用
 * （裸 path 前缀、只写在 listen 参数里的 socket）。返回 undefined 表示信息不够：
 * 既没有 socket，也没有可用端口（`port: 0` 是“由内核挑”，属于观测，不能进 key）。
 * host 未指定时按 `0.0.0.0`（不指定 host 就是监听通配地址）；要不要把它塌成 `*`
 * 由 `normalizeSocketAddress` 决定。
 */
function nativeAddressFromBind(options?: BindOptions): string | undefined {
   if (!options) {return undefined;}
   // 声明了 socket 就以它为准：底座就是那个文件，与 port 无关。port + path 同时给出
   // 本身就是矛盾输入，这里让声明优先，与 transport 取监听参数用的是同一份规则
   // （normalizeListenBind），否则地址与真实监听会错开。
   const socket = normalizeListenBind(options).socket;
   if (socket) {return unixSocketUri(socket);}

   const port = bindPort(options.port);
   if (!port) {return undefined;}
   let url: URL;
   try {url = new URL(`http://${options.host ?? '0.0.0.0'}`);} catch {return undefined;}
   url.port = port;
   return toAuthorityOnly(url);
}

/**
 * 用显式 bind 参数改写已有声明地址的 authority。
 * socket 声明优先于 host/port（与 nativeAddressFromBind 同一优先级）。
 *
 * 为什么 bind 参数要进 key：`start({ port: 3001 })` 是调用方**声明**的绑定，
 * 与 apiUrl 冲突时 apiUrl 才是过时的那一个——不改写就会把地址停在旧端口上，
 * 对真实底座漏报、对旧底座过报冲突。反之 `port: 0`（由内核挑端口）属于观测，
 * 不改写，key 跨 start 边界仍然稳定；真实端口由 `socketAddressFromListen` 补上。
 *
 * 返回 undefined 表示没什么可改写（无 bind 参数，或 base 不是按 authority
 * 寻址的 scheme），调用方沿用 apiUrl 派生的地址。
 */
function withBindOptions(base: string, options?: BindOptions): string | undefined {
   const socket = normalizeListenBind(options).socket;
   if (socket) {
      // 监听 unix socket：底座就是那个 socket 文件，host/port 不再相关
      return unixSocketUri(socket);
   }

   const port = bindPort(options?.port);
   const host = options?.host;
   if (!port && !host) {return undefined;}

   let url: URL;
   try {url = new URL(base);} catch {return undefined;}
   if (!ADDRESSABLE.has(url.protocol.toLowerCase()) || !url.hostname) {return undefined;}

   if (host) {url.hostname = host;}
   if (port) {url.port = port;}
   return toAuthorityOnly(url);
}

/**
 * 监听**前**的底座地址：apiUrl + 本轮 bind 参数 → 同一个地址 URI。
 *
 * bind 参数本身的解析（`normalizeListenBind`）就在本文件：`BindOptions` 与底座地址是
 * 同一件事的两半。本函数只做两件事：叠上 HTTP 的 host 语义，以及把 apiUrl 与 bind 合起来。
 *
 * 优先级：socket 声明 > apiUrl 的 authority（被 bind 改写）> 由 bind 参数造 > 没有。
 * 返回 `undefined` 表示「没有底座可说」，由调用方兜底（HTTP 退回 apiUrl 的规范化值，
 * Fastify 用合成的实例占位 key）。
 *
 * `bindDefaults` 只在 apiUrl 是裸 path 前缀时参与：那时 bind 参数是关于底座的唯一
 * 声明，不补就会让「同一端口的两个 transport」各建一个 server（第二个必 EADDRINUSE）。
 * 不传则表示「没声明就没底座」——尚未监听的共享实例不该假装自己占着某个端口。
 */
export function socketAddressFromBind(args: {
   apiUrl?: string;
   bind?: BindOptions;
   bindDefaults?: BindOptions;
}): string | undefined {
   const apiUrl = args.apiUrl || '';
   const bind = args.bind;

   const resolved = normalizeListenBind(bind ?? {});
   if (resolved.socket) {return normalizeSocketAddress(unixSocketUri(resolved.socket));}

   const base = normalizeSocketAddress(apiUrl);
   // apiUrl 里的端口可能过时：`start({ port })` 是调用方**声明**的绑定，改写它；
   // `port: 0`（内核挑端口）属于观测，不改写，key 跨 start 边界仍然稳定。
   const rewritten = withBindOptions(base, bind)
      ?? (hasUriScheme(apiUrl)
         ? undefined
         : nativeAddressFromBind(args.bindDefaults ? defaultsDeep({}, bind, args.bindDefaults) : bind));

   if (rewritten) {return normalizeSocketAddress(rewritten);}
   // 只有 HTTP 家族的形式才算底座；其余（裸 path、空、别的 scheme）交给调用方兜底。
   return /^https?:\/\//i.test(base) ? base : undefined;
}

/**
 * 监听**后**的底座地址：把内核观测值换成与 `socketAddressFromBind()` 同一个 URI。
 *
 * 观测值的形状按底座与框架而变（均实测）：
 *  - Node `server.address()`：TCP 给 `{ address, port }`，unix 给**裸路径字符串**
 *  - Fastify `listen()`：TCP 给 `http://…` URL 字符串，unix 给裸 socket 路径
 * 所以字符串分支不能假定它是 URL：有 `scheme://` 就当地址，没有就是文件系统路径。
 *
 * 两个分支都要过规范化，否则 `127.0.0.1` 观测与 `localhost` 声明对不上 key，
 * `port: 0` 之后池里多出一个假底座（下一个按声明地址复用它的实例会 ECONNREFUSED）。
 *
 * 返回 undefined 表示拿不到观测（尚未监听、或形状不认识），调用方沿用声明地址。
 */
export function socketAddressFromListen(observed: unknown): string | undefined {
   if (!observed) {return undefined;}

   if (typeof observed === 'string') {
      return AUTHORITY_SCHEME_RE.test(observed)
         ? normalizeSocketAddress(observed)
         : normalizeSocketAddress(unixSocketUri(observed));
   }

   if (typeof observed === 'object') {
      const { address, port, socketPath } = observed as { address?: string, port?: number, socketPath?: string };
      if (socketPath) {return normalizeSocketAddress(unixSocketUri(socketPath));}
      if (address && port !== undefined && port !== null) {return normalizeSocketAddress(`${address}:${port}`);}
   }

   return undefined;
}
