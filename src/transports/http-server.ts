import http from 'http';
import { AddressInfo } from 'net';
import { URL } from 'url';
import { Readable } from 'stream';
import {
   BindOptions,
   canonicalPhysicalUri,
   parsePhysicalUri,
   samePhysicalBase,
   unixSocketPath,
   unixSocketUri,
   withWildcardHost,
} from './physical-uri';
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
   refCount: number;
   /** pathname -> logical transport instance */
   routes: Map<string, HttpServerToolTransport>;
   /** 默认/降级实例 (当没有匹配到特定路径时) */
   defaultInstance?: HttpServerToolTransport;
   /** 初始化 Promise，用于并发 start 时同步等待物理 Ready */
   initPromise?: Promise<void>;
}

/** 物理分发命中的前缀，挂在原始请求上，供请求期解析所属逻辑路由。 */
const HTTP_CLAIM = Symbol('tool-rpc.httpClaim');

/**
 * HTTP 服务端传输协议。
 * 支持在同一物理端口上通过 URL Path 挂载多个逻辑 Transport 实例。
 */
export class HttpServerToolTransport extends ServerToolTransport {
   /** 静态物理底座池: "host:port" -> Binding */
   private static sharedServers = new Map<string, HttpBinding>();

   /** 最近一次声明的 RPC 前缀（归一化）；请求期优先使用命中的 claim。 */
   private rpcPrefix: string = '';
   private maxBodySize: number;

   constructor(options?: HttpServerToolTransportOptions) {
      super(options);
      this.maxBodySize = options?.maxBodySize || 1024 * 1024; // 默认 1MB
      this.canStream = true;
   }

   /** 本实例实际挂到的池 key（复用通配底座时与自身声明身份不同）。 */
   private bindingKey?: string;

   /**
    * apiUrl 派生的声明身份：canonical 物理 URI（`http://localhost:3000` / `http://*:8080`）。
    * 作为底座池 key 与分发 key；`start({ host, port, path })` 的显式 bind 参数
    * 会改写它（基类 applyBindOptions），因为那才是本实例真正要占的底座。
    *
    * 非回环 host 记为通配：不显式指定 host 时，本 transport 对非回环 host 一律监听
    * 0.0.0.0（监听不属于本机的主机名会 EADDRNOTAVAIL），它占的底座就是 `*:port`。
    * 因此 `http://a.example:8080` 与 `http://b.example:8080` 仍是同一个底座，
    * 与实测的 bind 行为一致（而不是丢掉 host 信息：它本来就没绑定那个 host）。
    * 显式指定 host 时不走这条规则：绑哪个就是哪个，见 withBindOptions。
    */
   protected apiUrlIdentity(): string {
      const uri = canonicalPhysicalUri(this.apiUrl);
      const parsed = parsePhysicalUri(uri);
      if (parsed.opaque || parsed.wildcard || parsed.host === 'localhost') {return uri;}
      return withWildcardHost(uri);
   }

   /**
    * 声明身份（本 transport 只有一个底座，所以这里收窄成 string）。
    * 池 key、分发 key、审计 key 均取此值，bind 改写由基类 resolvedBaseUrl() 提供。
    */
   public getBaseUrl(): string {
      return this.resolvedBaseUrl();
   }

   /**
    * `_start()` 在调用方未声明时的监听默认值（必须与那里一致）。apiUrl 是裸 path
    * 前缀时，它决定了能不能造出底座 URI：否则 `http://h:3000` 与 `/api`（也监听
    * 3000）会各自建一个 server，第二个必 EADDRINUSE。
    */
   protected defaultBindOptions(): BindOptions {
      return { port: 3000, host: '0.0.0.0' };
   }

   /**
    * 实际绑定观测：取自已复用/已监听的 http.Server。
    * 未 start 时返回 undefined；port 0 时它才是真实端口。
    */
   public getBoundAddress(): string | undefined {
      const binding = this.currentBinding();
      const bound = binding?.server.address() as AddressInfo | string | null;
      if (!bound) {return undefined;}
      // unix socket 的 address() 返回 socket 路径，不是 host:port
      if (typeof bound === 'string') {return unixSocketUri(bound);}
      return `${bound.address}:${bound.port}`;
   }

   /** 本实例当前依附的底座（未 start 时按声明身份查）。 */
   private currentBinding(): HttpBinding | undefined {
      const key = this.bindingKey ?? this.getBaseUrl();
      return HttpServerToolTransport.sharedServers.get(key);
   }

   /**
    * 底座复用查找：精确 key，或已监听通配地址且 scheme+port 相同的底座。
    * 只有「已有通配、现在要具体 host」这个方向可复用；反向必须新建
    * （实测：已有具体绑定时再监听 0.0.0.0 会 EADDRINUSE）。
    */
   private static findBinding(addr: string): { key: string; binding: HttpBinding } | undefined {
      const exact = HttpServerToolTransport.sharedServers.get(addr);
      if (exact) {return { key: addr, binding: exact };}
      for (const [key, binding] of HttpServerToolTransport.sharedServers) {
         if (parsePhysicalUri(key).wildcard && samePhysicalBase(key, addr)) {return { key, binding };}
      }
      return undefined;
   }

   public addDiscoveryHandler(apiUrl: string, handler: () => any, options?: RouteClaimOptions): void {
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

   /** 请求期解析：本次请求归属的逻辑前缀（由物理分发命中，或回退到最近声明的）。 */
   private claimPrefixOf(req: http.IncomingMessage): string {
      const claimed = (req as any)[HTTP_CLAIM];
      if (claimed) {return this.toPathname(claimed);}

      // 未经物理分发（直接调用，或兜底到 defaultInstance）时，
      // 在本实例声明过的前缀里做最长前缀匹配，而不是只看最后一次声明。
      const url = req.url || '/';
      const pathname = url.split('?')[0];
      const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`;
      let best = this.rpcPrefix || '/';
      let bestLen = -1;
      for (const prefix of this.routeClaims.keys()) {
         const match = this.toMatchPrefix(prefix);
         if (normalized.startsWith(match) && match.length > bestLen) {
            bestLen = match.length;
            best = prefix;
         }
      }
      return best;
   }

   /**
    * 启动物理监听（支持复用）
    */
   public async _start(options: BindOptions = {}): Promise<void> {
      const addr = this.getBaseUrl();
      const found = HttpServerToolTransport.findBinding(addr);
      let binding = found?.binding;
      const key = found?.key ?? addr;

      if (!binding) {
         const server = http.createServer((req, res) => HttpServerToolTransport.handleIncomingHttpRequest(key, req, res));
         binding = { server, refCount: 0, routes: new Map() };
         HttpServerToolTransport.sharedServers.set(key, binding);

         const parsed = parsePhysicalUri(key);
         const unixPath = unixSocketPath(key);
         // bind 参数里的 port 可能是字符串（来自环境变量之类），监听前要成数
         const defaults = this.defaultBindOptions();
         const port = options.port !== undefined ? Number(options.port) : (parsed.port ? parseInt(parsed.port) : Number(defaults.port));
         // 只有回环 host 才绑定到具体地址；其余一律监听通配（与旧行为一致）
         const host = options.host || (parsed.host === 'localhost' ? 'localhost' : defaults.host);

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
            HttpServerToolTransport.sharedServers.delete(key);
            throw err;
         } finally {
            binding.initPromise = undefined;
         }
      } else if (binding.initPromise) {
         // 等待正在进行的物理初始化完成
         await binding.initPromise;
      }

      // 记住实际底座：复用通配底座时，它与本实例的声明身份不是同一个 key
      this.bindingKey = key;

      // 注册当前实例的路由（物理表用带尾斜杠的匹配 key，避免 /api 误匹配 /apix）
      binding.refCount++;
      for (const path of this.getRoutes()) {
         binding.routes.set(this.toMatchPrefix(path), this);
      }
      if (!binding.defaultInstance) binding.defaultInstance = this;
   }

   public async stop(force?: boolean): Promise<void> {
      const addr = this.bindingKey ?? this.getBaseUrl();
      const binding = HttpServerToolTransport.sharedServers.get(addr);
      this.bindingKey = undefined;
      if (!binding) {
         return;
      }

      // 清理路由映射
      for (const path of this.getRoutes()) {
         binding.routes.delete(this.toMatchPrefix(path));
      }
      if (binding.defaultInstance === this) {
         binding.defaultInstance = binding.routes.values().next().value;
      }

      binding.refCount--;

      if (binding.refCount <= 0) {
         HttpServerToolTransport.sharedServers.delete(addr);
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
      if (!binding) return;

      const url = req.url || '/';
      const pathname = url.split('?')[0];
      // 归一化路径匹配：确保以 / 结尾以便进行前缀对比
      const normalizedPath = pathname.endsWith('/') ? pathname : pathname + '/';

      // 匹配最长前缀路由
      let bestMatch: HttpServerToolTransport | undefined;
      let bestPrefix: string | undefined;
      let longestPrefix = -1;

      for (const [prefix, instance] of binding.routes.entries()) {
         if (normalizedPath.startsWith(prefix) && prefix.length > longestPrefix) {
            longestPrefix = prefix.length;
            bestMatch = instance;
            bestPrefix = prefix;
         }
      }

      // 把命中的前缀交给请求，后续按它解析 registry / 发现处理器，
      // 而不是依赖实例上“最后一次声明”的那条。
      if (bestMatch && bestPrefix) {
         (req as any)[HTTP_CLAIM] = bestMatch.toPathname(bestPrefix);
      }

      const target = bestMatch || binding.defaultInstance;
      if (target) {
         target.handleInternalRequest(req, res);
      } else {
         res.statusCode = 404;
         res.setHeader('Content-Type', 'application/json');
         res.end(JSON.stringify({ error: 'Not Found' }));
      }
   }

   /**
    * 内部逻辑分发
    */
   private async handleInternalRequest(req: http.IncomingMessage, res: http.ServerResponse) {
      const { url, method } = req;
      if (!url) return this.sendError(res, 400, 'Bad Request');

      const pathname = url.split('?')[0];
      const normalizedPath = pathname.endsWith('/') ? pathname : pathname + '/';

      const claimPrefix = this.claimPrefixOf(req);
      const matchPrefix = this.toMatchPrefix(claimPrefix);

      // 1. Discovery Handler
      const discoveryHandler = this.routeDiscoveryHandler(claimPrefix);
      if (discoveryHandler && method === 'GET' && normalizedPath === matchPrefix) {
         try {
            const result = discoveryHandler();
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify(result));
         } catch (e: any) {
            this.sendError(res, 500, e.message);
         }
         return;
      }

      // 2. RPC Handler (基于命中前缀的业务流水线)
      if (normalizedPath.startsWith(matchPrefix)) {
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

   protected async toRpcRequest(rawReq: http.IncomingMessage, rawRes?: http.ServerResponse): Promise<ToolRpcRequest> {
      const headersStr: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawReq.headers)) {
         if (Array.isArray(v)) {
            headersStr[k] = v.join(',');
         } else if (v !== undefined) {
            headersStr[k] = v;
         }
      }

      let toolId = headersStr[RPC_HEADERS.TOOL_ID] || headersStr[RPC_HEADERS.FUNC];
      let act = headersStr[RPC_HEADERS.ACT];
      let resId = headersStr[RPC_HEADERS.RES_ID];

      const matchPrefix = this.toMatchPrefix(this.claimPrefixOf(rawReq));

      if (!toolId && rawReq.url) {
         const urlPath = rawReq.url.split('?')[0].substring(matchPrefix.length);
         const parts = urlPath.split('/').map(s => s === undefined ? s : decodeURIComponent(s)).filter(Boolean);
         if (parts.length > 0) {
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
            const requestUrl = new URL(rawReq.url || '/', `http://${rawReq.headers.host || 'localhost'}`);
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
         apiUrl: this.apiUrl || `http://${rawReq.headers.host}${matchPrefix}`,
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
            const requestId = rpcRes.headers?.[RPC_HEADERS.REQUEST_ID] as string;
            if (requestId) {
               const handle = this.dispatcher.tracker.get(requestId);
               if (handle) handle.abort('Physical connection closed');
            }
            if (!nodeStream.destroyed) nodeStream.destroy('Physical connection closed' as any);
         });
      } else {
         rawRes.end(JSON.stringify(result === undefined ? null : result));
      }
   }

   private getRequestBody(req: http.IncomingMessage): Promise<string> {
      return new Promise((resolve, reject) => {
         let body = '';
         let currentSize = 0;
         req.on('data', chunk => {
            currentSize += chunk.length;
            if (currentSize > this.maxBodySize) {
               const err: any = new Error('Payload Too Large');
               err.status = 413;
               reject(err);
            } else {
               body += chunk.toString();
            }
         });
         req.on('end', () => resolve(body));
         req.on('error', reject);
      });
   }

   public getRaw(): http.Server | undefined {
      return this.currentBinding()?.server;
   }
}
