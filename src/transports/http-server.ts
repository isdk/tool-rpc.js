import http from 'http';
import { URL } from 'url';
import { Readable } from 'stream';
import {
   BindOptions,
   normalizeSocketAddress,
   normalizeHostAndPort,
   normalizeListenBind,
   socketAddressFromBind,
   socketAddressFromListen,
   unixSocketPath,
} from './socket-address';
import {
   matchRoute,
   normalizeRoutePath,
   NormalizedRoutePath,
   RoutePathError,
   routeMatchKey,
} from './route-path';
import { RouteClaimOptions, ServerToolTransport, ServerToolTransportOptions } from './server';
import { ToolRpcRequest, ToolRpcResponse, RPC_HEADERS, RpcStatusCode, RpcError } from './models';
import { uuidv4 } from '@isdk/hash';

export interface HttpServerToolTransportOptions extends ServerToolTransportOptions, http.ServerOptions {
   /** 最大请求体大小 (字节)，默认 1MB */
   maxBodySize?: number;
}

/**
 * 物理 Server 绑定信息
 */
interface HttpBinding {
   server: http.Server;
   /** 当前池 key；port 0 监听后要改成观测到的底座，否则 key 在谎报一个没监听的端口 */
   key: string;
   /** 每个**实例**只计一次，重复 start/stop 不会把计数玩坏 */
   refCount: number;
   /** match key -> logical transport instance（key 就是 owner，重复声明必须拒掉） */
   routes: Map<string, HttpServerToolTransport>;
   /** 默认/降级实例 (当没有匹配到特定路径时) */
   defaultInstance?: HttpServerToolTransport;
   /** 初始化 Promise，用于并发 start 时同步等待物理 Ready */
   initPromise?: Promise<void>;
   /** 底座上任一实例开了尾斜杠严格模式就得整体开，否则两侧规范化会错位 */
   strictTrailingSlash: boolean;
}

/** 物理分发命中的前缀，挂在原始请求上，供请求期解析所属逻辑路由。 */
const HTTP_CLAIM = Symbol('tool-rpc.httpClaim');
/** 归一化后的请求路径（含解码段），挂在原始请求上，避免每层各自规范化一遍。 */
const HTTP_ROUTE = Symbol('tool-rpc.httpRoute');

/* ---------------------------------------------------------------------------
 * 本文件只管 HTTP 的**物理底座**：sharedServers 池、refCount、最长前缀分发表。
 * 地址归一与 bind 参数解析在 socket-address.ts（与 tool-rpc-fastify 共用同一份规则）。
 * ------------------------------------------------------------------------- */

/** 未经业务流水线的物理层响应（404/400/503）。 */
function sendPlainError(res: http.ServerResponse, code: number, message: string): void {
   res.statusCode = code;
   res.setHeader('Content-Type', 'application/json');
   res.end(JSON.stringify({ error: message }));
}

/**
 * 转交给 `http.createServer` 的底座选项（`http.ServerOptions` + `net.ServerOptions` 的键）。
 *
 * `HttpServerToolTransportOptions extends http.ServerOptions`，所以 `maxHeaderSize`、
 * `keepAlive`、`requestTimeout` 这些是公开承诺；以前 `createServer` 一个都不转，
 * 类型上能写、运行时静默无效（实测 `maxHeaderSize: 64` 照样收下 2KB 的请求头）。
 * 只转白名单里的键：transport 自己的 `apiUrl` / `manager` / `dispatcher` / bind 参数
 * 不能混进 Node 的 Server 构造。
 */
const HTTP_SERVER_OPTION_KEYS: ReadonlyArray<string> = [
   'IncomingMessage', 'ServerResponse', 'requestTimeout', 'joinDuplicateHeaders',
   'keepAliveTimeout', 'keepAliveTimeoutBuffer', 'connectionsCheckingInterval',
   'headersTimeout', 'highWaterMark', 'insecureHTTPParser', 'maxHeaderSize', 'noDelay',
   'requireHostHeader', 'keepAlive', 'keepAliveInitialDelay', 'uniqueHeaders',
   'shouldUpgradeCallback', 'rejectNonStandardBodyWrites', 'optimizeEmptyRequests',
   'pauseOnConnect', 'allowHalfOpen',
];

function serverOptionsOf(options?: HttpServerToolTransportOptions): http.ServerOptions {
   const out: Record<string, any> = {};
   for (const key of HTTP_SERVER_OPTION_KEYS) {
      const value = (options as any)?.[key];
      if (value !== undefined) {out[key] = value;}
   }
   return out as http.ServerOptions;
}

/**
 * 从 canonical 底座地址取监听用的 host / port（地址由 `normalizeSocketAddress` 产出，
 * 所以 host 已经是唯一写法：回环别名是 `localhost`，通配写法是 `*`）。
 *
 * 不用 `lastIndexOf(':')` 与 `/localhost/i` 扫字符串：前者在 IPv6 上取错段，
 * 后者把 `mylocalhost.example` 这种 vhost 误判成回环，于是绑到 `127.0.0.1`，
 * 外部根本连不上（实测）。
 */
function listenTargetOf(addr: string): { host?: string, port?: number } {
   if (!addr || /^unix:/i.test(addr)) {return {};}
   try {
      const url = new URL(addr);
      return {
         host: url.hostname || undefined,
         port: url.port ? Number(url.port) : undefined,
      };
   } catch {
      return {};
   }
}

/**
 * HTTP 服务端传输协议。
 * 支持在同一物理端口上通过 URL Path 挂载多个逻辑 Transport 实例。
 */
export class HttpServerToolTransport extends ServerToolTransport {
   /** 静态物理底座池: "host:port" -> Binding */
   private static sharedServers = new Map<string, HttpBinding>();

   /** 最近一次声明的 RPC 前缀（归一化）；请求期优先使用命中的 claim。 */
   private rpcPrefix: string = '';
   /**
    * 本实例已在哪个底座上登记过路由。`refCount` 按「实例 attach 到底座」计一次，
    * 所以「同一底座上补登记新前缀」不能再 +1；`stop()` 也按它决定要不要 -1。
    */
   private attachedKey?: string;
   private maxBodySize: number;

   constructor(options?: HttpServerToolTransportOptions) {
      super(options);
      this.maxBodySize = options?.maxBodySize || 1024 * 1024; // 默认 1MB
      this.canStream = true;
   }

   /** 本实例实际挂到的底座（port 0 监听后就是内核选的那个）。 */
   private bindingKey?: string;
   /** 本轮 `start()` 的 bind 参数；地址由它 + apiUrl 算出，所以得存下来。 */
   private bindOptions?: BindOptions;

   /**
    * 本服务可被访问的地址（`http://localhost:3000`、`unix:/run/x.sock`）。
    * 监听前是声明值（apiUrl + `start({ host, port, path })`），监听后是真实底座
    * （port 0 时只有内核知道端口）。同时也是底座池 key 与归属登记 key。
    *
    * 地址语义全在本 transport 里：基类只把地址当不透明字符串。
    * 不把非回环 host 塌成通配——以前会把 `http://a.example:8080` 改写成 `http://*:8080`，
    * 于是两个不同 host 同端口直接报路由冲突：那是拿预测代替内核的答复，还把 vhost 判死了。
    * 现在 key 就是那个 authority：不相等就各自 listen，真撞了 EADDRINUSE 自会报。
    */
   public getListenAddr(): string {
      return this.bindingKey ?? this.declaredAddress();
   }

   /**
    * 由 apiUrl 与本轮 bind 参数算出的地址（规则在 socket-address.ts，与 Fastify transport 同一份）。
    * apiUrl 是裸 path 前缀（只说了路由、没说底座）时，bind 参数就是关于底座的唯一声明，
    * 不补就会让“同一端口”的两个 transport 各建一个 server，第二个必 EADDRINUSE ——
    * 所以这里要传 defaultBindOptions()。
    */
   private declaredAddress(): string {
      return socketAddressFromBind({
         apiUrl: this.apiUrl,
         bind: this.bindOptions,
         bindDefaults: this.defaultBindOptions(),
      }) ?? normalizeSocketAddress(this.apiUrl || '');
   }

   /**
    * `_start()` 在调用方未声明时的监听默认值（必须与那里一致）。apiUrl 是裸 path
    * 前缀时，它决定了能不能造出底座 URI：否则 `http://h:3000` 与 `/api`（也监听
    * 3000）会各自建一个 server，第二个必 EADDRINUSE。
    */
   protected defaultBindOptions(): BindOptions {
      return { port: 3000, host: '0.0.0.0' };
   }

   /** 本实例当前依附的底座（未 start 时按声明身份查）。 */
   private currentBinding(): HttpBinding | undefined {
      const key = this.bindingKey ?? this.getListenAddr();
      return HttpServerToolTransport.sharedServers.get(key);
   }

   /**
    * 底座复用查找：只按 canonical key 精确匹配。
    * 不做「通配覆盖具体 host」那种包含判断——那是预测 bind 冲突，非传递（会漏报），
    * 又会把不同 host 塌成同一个底座（误报）。key 不相等就各自 listen，
    * 真撞了由内核报 EADDRINUSE。
    */
   private static findBinding(addr: string): HttpBinding | undefined {
      return HttpServerToolTransport.sharedServers.get(addr);
   }

   /**
    * 本实例是否已经在这个底座上占好了**全部**路由（重复 start 就到此为止）。
    *
    * `every` 而不是 `some`：start 之后新增的前缀也必须登记。用 `some` 时
    * 「已有一个前缀在表上」就足以让第二次 start 提前返回，新前缀进不了物理路由表，
    * 只能靠 `defaultInstance` 兜底 —— 实测 `/v3` 直接 404（或落到别的实例）。
    */
   private isAttached(): boolean {
      if (!this.bindingKey || this.attachedKey !== this.bindingKey) {return false;}
      const binding = HttpServerToolTransport.sharedServers.get(this.bindingKey);
      if (!binding) {return false;}
      return this.getRoutes().every(path => binding.routes.get(this.toMatchPrefix(path)) === this);
   }

   /**
    * @deprecated 发现端点已由内置工具 `rpcApis` 接管；只有要自定义该前缀列什么时才需要它。
    * 迁移提示进程级只打一次（`warnDiscoveryDeprecated`）。
    */
   public addDiscoveryHandler(apiUrl: string, handler: () => any, options?: RouteClaimOptions): void {
      this.warnDiscoveryDeprecated();
      if (!this.apiUrl) this.apiUrl = apiUrl;
      // 发现处理器登记在基类的 claim 上（按前缀），同一实例声明多个前缀时互不覆盖；
      // 重复声明同一前缀由 remount 决定替换还是抛错。
      this.claimRoute(apiUrl, 'discovery', { discoveryHandler: handler, remount: options?.remount });
   }

   public addRpcHandler(apiUrl: string, options?: RouteClaimOptions) {
      if (!this.apiUrl) this.apiUrl = apiUrl;
      const claim = this.claimRoute(apiUrl, 'rpc', { registry: options?.registry, remount: options?.remount });
      if (!claim) return;
      this.rpcPrefix = claim.prefix;
   }

   /** 请求期解析：本次请求归属的逻辑前缀（由物理分发命中，或回退到命中的自有声明）。 */
   private claimPrefixOf(req: http.IncomingMessage): string {
      const claimed = (req as any)[HTTP_CLAIM];
      if (claimed) {return claimed;}

      // 未经物理分发（直接调用，或兜底到 defaultInstance）时，
      // 在本实例声明过的前缀里做最长前缀匹配，而不是只看最后一次声明。
      const matchKey = routeMatchKey(this.routeOf(req).path);
      let best = this.rpcPrefix || '/';
      let bestLen = -1;
      for (const prefix of this.routeClaims.keys()) {
         const key = this.toMatchPrefix(prefix);
         if (matchKey.startsWith(key) && key.length > bestLen) {
            bestLen = key.length;
            best = prefix;
         }
      }
      return best;
   }

   /**
    * 基类只能从 apiUrl 反推命中前缀；HTTP 在物理分发阶段已经算过（`HTTP_CLAIM`），
    * 直接取它，不让注册表分层与路由表再各做一最长匹配（两侧规则不一致就会列错工具）。
    */
   protected matchedPrefix(rpcReq: ToolRpcRequest): string | undefined {
      const rawReq: any = rpcReq.raw?._req;
      if (!rawReq) {return super.matchedPrefix(rpcReq);}

      const claimed = rawReq[HTTP_CLAIM];
      if (claimed) {return claimed;}
      if (this.routeClaims.size > 0) {return this.claimPrefixOf(rawReq);}
      return super.matchedPrefix(rpcReq);
   }

   /** 归一化后的请求路径；物理分发已算过则直接取。 */
   private routeOf(req: http.IncomingMessage): NormalizedRoutePath {
      const cached = (req as any)[HTTP_ROUTE] as NormalizedRoutePath | undefined;
      if (cached) {return cached;}
      // 非法转义 / 越出根：抛 RoutePathError（status 400），由 processIncomingCall 回 400，
      // 不再落到 500
      const route = normalizeRoutePath(req.url || '/', { mode: 'request', strictTrailingSlash: this.strictTrailingSlash });
      (req as any)[HTTP_ROUTE] = route;
      return route;
   }

   /**
    * 启动物理监听（支持复用）
    */
   public async _start(options: BindOptions = {}): Promise<void> {
      // 地址由 apiUrl + 本轮 bind 参数算出，所以先存下参数（getListenAddr 要用）
      this.bindOptions = options;

      // 重复 start 幂等：不幂等就会重复 refCount++，一次 stop 关不掉底座
      if (this.isAttached()) {return;}

      const addr = this.getListenAddr();
      let binding = HttpServerToolTransport.findBinding(addr);

      if (!binding) {
         const placeholder: { key: string } = { key: addr };
         const server = http.createServer(
            serverOptionsOf(this.options),
            (req, res) => HttpServerToolTransport.handleIncomingHttpRequest(placeholder.key, req, res));
         binding = { server, key: addr, refCount: 0, routes: new Map(), strictTrailingSlash: false };
         HttpServerToolTransport.sharedServers.set(addr, binding);

         const unixPath = unixSocketPath(addr);
         // bind 参数里的 port 可能是字符串（来自环境变量之类），监听前要成数；
         // socket 的三个别名与「socket 优先于 host/port」也在那一处解析
         const bind = normalizeListenBind(options);
         const defaults = this.defaultBindOptions();
         const declared = listenTargetOf(addr);
         const port = bind.port ?? declared.port ?? Number(defaults.port);
         // 只有回环 host 才绑定到具体地址；其余一律监听通配（与旧行为一致）。
         // 判据是 canonical 地址解析出的 hostname（回环别名已被收成 `localhost`），
         // 不是对地址串做子串匹配
         const host = bind.host || (declared.host === 'localhost' ? 'localhost' : defaults.host);

         binding.initPromise = new Promise<void>((resolve, reject) => {
            binding!.server.on('error', (err) => {
               reject(err);
            });
            const onListening = () => {
               binding!.server.off('error', reject);
               resolve();
            };
            // unix 身份：底座就是那个 socket 文件，没有 host/port 可言
            if (unixPath) {
               binding!.server.listen(unixPath, onListening);
            } else {
               binding!.server.listen(port, host, onListening);
            }
         });

         try {
            await binding.initPromise;
         } catch (err) {
            HttpServerToolTransport.sharedServers.delete(binding.key);
            throw err;
         } finally {
            binding.initPromise = undefined;
         }

         // port 0 是内核挑端口：声明身份里写着的端口并没有人占。
         // 不把池 key 改成真实底座，下一个按声明身份复用它的实例就会以为
         // 自己已经在那个端口上服务（实测：请求 ECONNREFUSED）。
         const observed = this.observedNativeAddress(binding.server);
         if (observed && observed !== binding.key) {
            HttpServerToolTransport.sharedServers.delete(binding.key);
            binding.key = observed;
            placeholder.key = observed;
            HttpServerToolTransport.sharedServers.set(observed, binding);
         }
      } else if (binding.initPromise) {
         // 等待正在进行的物理初始化完成
         await binding.initPromise;
      }

      // 先查所有权：同一底座上这个前缀已被别的实例占着，就报错而不是静默改指向
      // （以前是 set 直接覆盖，第二个实例把第一个的路由抢走，且 manager 不参与时无人报错）
      for (const path of this.getRoutes()) {
         const matchKey = this.toMatchPrefix(path);
         const owner = binding.routes.get(matchKey);
         if (owner && owner !== this) {
            throw new Error(`Route already claimed: "${path}" on ${binding.key} is claimed by ${owner.constructor.name}`);
         }
      }

      // 记住实际底座；地址定下来了（port 0 可能换了端口），归属登记条目跟着迁移
      this.bindingKey = binding.key;
      this.registerRoutes();
      if (this.strictTrailingSlash) {binding.strictTrailingSlash = true;}

      // 注册当前实例的路由（物理表用带尾斜杠的匹配 key，避免 /api 误匹配 /apix）。
      // refCount 只在「首次 attach 到这个底座」时 +1：第二次 start 只是补登记新前缀，
      // 再 +1 就会让一次 stop 关不掉底座
      if (this.attachedKey !== binding.key) {binding.refCount++;}
      this.attachedKey = binding.key;
      for (const path of this.getRoutes()) {
         binding.routes.set(this.toMatchPrefix(path), this);
      }
      if (!binding.defaultInstance) binding.defaultInstance = this;
   }

   /** 监听后的真实底座（canonical）；拿不到观测时返回 undefined。 */
   private observedNativeAddress(server: http.Server): string | undefined {
      // 观测值 → 地址的规则与 Fastify 那份合并到 socketAddressFromListen：TCP 给
      // `{ address, port }`、unix 给裸路径，两边都要过同一个规范化（补 http://、
      // 规范化回环写法、unix 路径词法归一），否则观测 key 与声明 key 对不上，
      // port 0 之后池里多出一个假底座。
      return socketAddressFromListen(server.address());
   }

   public async stop(force?: boolean): Promise<void> {
      const addr = this.bindingKey ?? this.getListenAddr();
      const binding = HttpServerToolTransport.sharedServers.get(addr);
      const attached = this.attachedKey;
      this.bindingKey = undefined;
      this.attachedKey = undefined;
      this.unregisterRoutes();
      if (!binding) {
         return;
      }

      // 只删自己占的路由：不记 owner 就会把另一个实例还在用的条目删掉。
      // 按 owner 扫整张表而不是只看「当前声明的前缀」：start 之后撤掉的前缀
      // 若不删，就会留在表上把后来者挡在门外
      for (const [key, owner] of binding.routes) {
         if (owner === this) {binding.routes.delete(key);}
      }
      // 没在这个底座上 attach 过就不动 refCount：重复 stop 会把计数压负，
      // 连带关掉另一个实例还在用的 server
      if (attached !== binding.key) {
         return;
      }
      if (binding.defaultInstance === this) {
         binding.defaultInstance = binding.routes.values().next().value;
      }

      binding.refCount--;

      if (binding.refCount <= 0) {
         HttpServerToolTransport.sharedServers.delete(binding.key);
         return new Promise((resolve, reject) => {
            if (force) binding.server.closeAllConnections();
            binding.server.close((err: any) => {
               // 忽略 "Server is not running" 错误，这在并发 start/stop 场景下是正常的
               if (err && err.code === 'ERR_SERVER_NOT_RUNNING') {
                  resolve();
               } else if (err) {
                  reject(err);
               } else {
                  resolve();
               }
            });
         });
      }
   }

   /**
    * 物理请求分发器（入口点）
    */
   private static handleIncomingHttpRequest(addr: string, req: http.IncomingMessage, res: http.ServerResponse) {
      const binding = HttpServerToolTransport.sharedServers.get(addr);
      if (!binding) {
         // 底座已被 stop（或请求打到一个从未登记过的 server）。
         // 静默不响应会让客户端挂到超时，明确回 503。
         return sendPlainError(res, 503, `No transport on ${addr}`);
      }

      // 声明侧与请求侧走同一套 normalizeRoutePath：以前请求侧不折叠 `//`、不解析 dot 段，
      // 于是 `addRpcHandler('/a//b')` 声明的路由自不可达，而 `/api/v2/../x` 命中哪个
      // transport 取决于中间代理有没有规范化 URL。
      let route: NormalizedRoutePath;
      try {
         route = normalizeRoutePath(req.url || '/', { mode: 'request', strictTrailingSlash: binding.strictTrailingSlash });
      } catch (err: any) {
         // 非法转义 / dot 段越出根 → 400；其余才是实现缺陷 → 500
         const status = err instanceof RoutePathError ? 400 : 500;
         return sendPlainError(res, status, err.message || 'Bad Request');
      }
      (req as any)[HTTP_ROUTE] = route;

      // 最长前缀匹配（key 已补尾斜杠，所以 /api 不会误匹配 /apix）
      const hit = matchRoute(binding.routes, routeMatchKey(route.path));
      if (hit) {
         // 把命中的前缀交给请求，后续按它解析 registry / 发现处理器，
         // 而不是依赖实例上“最后一次声明”的那条。
         (req as any)[HTTP_CLAIM] = hit.prefix;
         hit.value.handleInternalRequest(req, res);
         return;
      }

      const target = binding.defaultInstance;
      if (target) {
         target.handleInternalRequest(req, res);
      } else {
         sendPlainError(res, 404, 'Not Found');
      }
   }

   /**
    * 内部逻辑分发
    */
   private async handleInternalRequest(req: http.IncomingMessage, res: http.ServerResponse) {
      let route: NormalizedRoutePath;
      try {
         route = this.routeOf(req);
      } catch (err: any) {
         // 非法转义 / dot 段越出根：400，不是 500
         const status = err instanceof RoutePathError ? 400 : 500;
         return this.sendError(res, status, err.message || 'Bad Request');
      }

      const claimPrefix = this.claimPrefixOf(req);
      const matchPrefix = this.toMatchPrefix(claimPrefix);
      const matchKey = routeMatchKey(route.path);

      // 业务流水线（包含内置发现端点）：请求属于哪个前缀就交给它的 processIncomingCall，
      // 「这条 URL 算哪个工具」由路由表在 toRpcRequest 里算（内置发现端点就是表里的一行）。
      // 这里不再为发现端点开分叉——开了它就绕过 validateRpcRequest / 身份判定 / 超时。
      if (matchKey.startsWith(matchPrefix)) {
         await this.processIncomingCall(req, res);
         return;
      }

      this.sendError(res, 404, 'Not Found');
   }

   private sendError(res: http.ServerResponse, code: number, message: string) {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: message }));
   }

   /** header 归一化：数组拼接、去 undefined。业务流水线与内置端点的身份判定共用。 */
   protected normalizeHeaders(rawReq: http.IncomingMessage): Record<string, string> {
      const headersStr: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawReq.headers)) {
         if (Array.isArray(v)) {
            headersStr[k] = v.join(',');
         } else if (v !== undefined) {
            headersStr[k] = v;
         }
      }
      return headersStr;
   }

   protected async toRpcRequest(rawReq: http.IncomingMessage, rawRes?: http.ServerResponse): Promise<ToolRpcRequest> {
      const headersStr = this.normalizeHeaders(rawReq);

      let toolId = headersStr[RPC_HEADERS.TOOL_ID] || headersStr[RPC_HEADERS.FUNC];
      let act = headersStr[RPC_HEADERS.ACT];
      let resId = headersStr[RPC_HEADERS.RES_ID];

      const claimPrefix = this.claimPrefixOf(rawReq);
      const matchPrefix = this.toMatchPrefix(claimPrefix);

      // 取归一化路径里 claim 之后的段：段已按段解码，且 `%2F` 保持编码，
      // 所以 `/api/a%2Fb` 的 toolId 是 `a%2Fb` 而不是两个段（以前先 split 再 decode，
      // 会把编码斜杠解成分隔符，一个段被切成两个 toolId）。
      const route = this.routeOf(rawReq);
      const claimDepth = normalizeRoutePath(claimPrefix, { mode: 'request', strictTrailingSlash: this.strictTrailingSlash }).segments.length;
      const parts = route.segments.slice(claimDepth);
      // 前缀内路径（根就是 '/'；`''` 与 `'/'` 同义，归一化后只有一个形态）
      const relPath = `/${parts.join('/')}`;

      // 路由表优先：内置发现端点（GET 前缀根 → `rpcApis`）与第三方 `addRoute` 声明都走这一条。
      // 只在请求没显式给 toolId header 时生效——header 是显式寻址，比路径声明更硬。
      if (!toolId) {
         const entry = this.matchRouteEntry(claimPrefix, { path: relPath, method: rawReq.method, act });
         if (entry) {
            toolId = entry.toolId;
            if (entry.act) {act = entry.act;}
            if (entry.resId !== undefined && resId === undefined) {resId = entry.resId;}
         } else if (parts.length > 0) {
            toolId = parts[0];
            if (parts.length > 1 && resId === undefined) {
               resId = parts[1];
            }
         }
      }

      const method = rawReq.method;
      let params: any = {};

      try {
         if (method === 'GET' || method === 'DELETE') {
            const requestUrl = new URL(rawReq.url || '/', `http://${normalizeHostAndPort(rawReq.headers.host || '') || 'localhost'}`);
            const p = requestUrl.searchParams.get('p');
            params = p ? JSON.parse(p) : {};
            headersStr['x-http-method'] = method!;
         } else {
            const body = await this.getRequestBody(rawReq);
            params = body ? JSON.parse(body) : {};
            headersStr['x-http-method'] = method!;
         }
      } catch (e: any) {
         const err: any = new RpcError(`Malformed JSON or Request: ${e.message}`, e.status || 400);
         throw err;
      }

      if (!toolId) {
         const err: any = new RpcError("Missing routing information: rpc-fn header or valid URL Path", 400);
         throw err;
      }

      // console.log('[HttpServer] toRpcRequest extracted:', {
      //    toolId,
      //    act,
      //    resId,
      //    method,
      //    url: rawReq.url
      // });

      const reqObj: ToolRpcRequest = {
         // Host 头是客户端可控输入，而它会被喂给 SSRF 校验（`url.includes(pattern)`）。
         // 不规范化就会让 `Host: LocalHost` 绕过针对 `localhost` 的限制（归一函数在
         // socket-address.ts，与任何从客户端 host 字符串推身份的 transport 共用）。
         apiUrl: this.apiUrl || `http://${normalizeHostAndPort(rawReq.headers.host || '')}${matchPrefix}`,
         toolId: toolId,
         act: act,
         resId: resId,
         clientId: headersStr[RPC_HEADERS.CLIENT_ID] as string,
         traceId: headersStr[RPC_HEADERS.TRACE_ID],
         requestId: (headersStr[RPC_HEADERS.REQUEST_ID] as string) || uuidv4(),
         params: params,
         headers: headersStr,
         raw: { _req: rawReq, _res: rawRes || null }
      };

      return reqObj;
   }

   protected async sendRpcResponse(rpcRes: ToolRpcResponse, rawRes: http.ServerResponse): Promise<void> {
      if (rawRes.headersSent) return;

      rawRes.statusCode = rpcRes.status;
      if (rpcRes.headers) {
         for (const [k, v] of Object.entries(rpcRes.headers)) {
            rawRes.setHeader(k, String(v));
         }
      }
      rawRes.setHeader('Content-Type', 'application/json');

      if (rpcRes.status === 102 || rpcRes.status === RpcStatusCode.PROCESSING) {
         rawRes.statusCode = 202;
         const dataPayload = rpcRes.data || { status: 102, message: 'Task moved to background' };
         rawRes.end(JSON.stringify(dataPayload));
         return;
      }

      if (rpcRes.error) {
         rawRes.end(JSON.stringify({ error: rpcRes.error }));
         return;
      }

      const result = rpcRes.data;
      if (result && typeof result.pipe === 'function') {
         // 源流出错：`pipe` 既不把错误转给响应、也不结束它 —— 实测响应挂死到客户端
         // 超时，而且 `error` 无人监听直接变成进程级未捕获异常。这里显式收尾：
         // 头还没发就回 500；已经发了就只能断连（让客户端看到失败，而不是半截成功）
         // 鸭子类型的流（只有 pipe、没有 on）也得能服务，所以能力检测后再挂
         if (typeof (result as any).on === 'function') {
            (result as any).on('error', (err: any) => {
               const reason = err?.message || 'Stream error';
               this.abortTrackedTask(rpcRes, reason);
               if (rawRes.destroyed) {return;}
               if (!rawRes.headersSent) {
                  this.sendError(rawRes, 500, reason);
               } else if (!rawRes.writableEnded) {
                  rawRes.destroy();
               }
            });
         }
         result.pipe(rawRes);
         rawRes.on('close', () => {
            if (!result.destroyed && typeof result.destroy === 'function') {
               result.destroy();
            }
         });
      } else if (result && typeof (Readable as any).fromWeb === 'function' && result instanceof ReadableStream) {
         const nodeStream = (Readable as any).fromWeb(result);
         nodeStream.on('error', () => { });
         nodeStream.pipe(rawRes);
         rawRes.on('close', () => {
            this.abortTrackedTask(rpcRes, 'Physical connection closed');
            if (!nodeStream.destroyed) nodeStream.destroy('Physical connection closed' as any);
         });
      } else {
         rawRes.end(JSON.stringify(result === undefined ? null : result));
      }
   }

   /** 物理连接断开或源流出错：注销对应的后台任务句柄（若有）。 */
   private abortTrackedTask(rpcRes: ToolRpcResponse, reason: string): void {
      const requestId = rpcRes.headers?.[RPC_HEADERS.REQUEST_ID] as string;
      if (!requestId) {return;}
      const handle = this.dispatcher.tracker.get(requestId);
      if (handle) handle.abort(reason);
   }

   private getRequestBody(req: http.IncomingMessage): Promise<string> {
      return new Promise((resolve, reject) => {
         const chunks: Buffer[] = [];
         let currentSize = 0;
         let failed = false;
         req.on('data', chunk => {
            // 统一成 Buffer：字节数才是 maxBodySize 的量纲，而且有人 `setEncoding('utf8')`
            // 后块就是字符串，不能直接丢给 Buffer.concat
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            currentSize += buf.length;
            if (currentSize > this.maxBodySize) {
               if (!failed) {
                  const err: any = new Error('Payload Too Large');
                  err.status = 413;
                  failed = true;
                  reject(err);
               }
               // 超限后不再累积（不 destroy：413 响应还要发出去），但也不能继续把
               // 对端推来的数据存下来
               return;
            }
            if (!failed) {chunks.push(buf);}
         });
         req.on('end', () => {
            if (failed) {return;}
            // 收齐再按 UTF-8 解码：逐块 `chunk.toString()` 会把跨块的多字节字符切成
            // U+FFFD，参数被静默改坏而状态码仍是 200（实测 `{"text":"中文"}` → `{"text":"��文"}`）
            resolve(Buffer.concat(chunks).toString('utf8'));
         });
         req.on('error', reject);
      });
   }

   public getRaw(): http.Server | undefined {
      return this.currentBinding()?.server;
   }
}
