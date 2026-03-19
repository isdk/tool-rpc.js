import http from 'http';
import { URL } from 'url';
import { Readable } from 'stream';
import { ServerToolTransport, ServerToolTransportOptions } from './server';
import { ToolRpcRequest, ToolRpcResponse, RPC_HEADERS, RpcStatusCode } from './models';
import { randomUUID } from 'crypto';

export interface HttpServerToolTransportOptions extends ServerToolTransportOptions, http.ServerOptions {
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
}

/**
 * HTTP 服务端传输协议。
 * 支持在同一物理端口上通过 URL Path 挂载多个逻辑 Transport 实例。
 */
export class HttpServerToolTransport extends ServerToolTransport {
   /** 静态物理底座池: "host:port" -> Binding */
   private static sharedServers = new Map<string, HttpBinding>();

   private managedPaths: string[] = [];
   private discoveryHandlerInfo: { prefix: string; handler: () => any } | null = null;
   private rpcPrefix: string = '';

   constructor(options?: HttpServerToolTransportOptions) {
      super(options);
   }

   public getListenAddr(): string {
      const url = new URL(this.apiUrl);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      let hostname = url.hostname;

      // 归一化本地回环地址，确保物理复用
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
         hostname = 'localhost';
      }

      // 返回 host:port 形式表示精确绑定，或 :port 形式表示监听 0.0.0.0
      return (hostname === 'localhost')
         ? `${hostname}:${port}`
         : `:${port}`;
   }

   public getRoutes(): string[] {
      return this.managedPaths.length > 0 ? this.managedPaths : [this.rpcPrefix || '/'];
   }

   public addDiscoveryHandler(apiUrl: string, handler: () => any): void {
      if (!this.apiUrl) this.apiUrl = apiUrl;
      const url = new URL(apiUrl);
      let prefix = url.pathname;
      if (!prefix.endsWith('/')) {
         prefix += '/';
      }
      this.discoveryHandlerInfo = { prefix, handler };
      if (!this.managedPaths.includes(prefix)) {
         this.managedPaths.push(prefix);
      }
   }

   public addRpcHandler(apiUrl: string, options?: any) {
      if (!this.apiUrl) this.apiUrl = apiUrl;
      const url = new URL(apiUrl);
      let prefix = url.pathname;
      if (!prefix.endsWith('/')) {
         prefix += '/';
      }
      this.rpcPrefix = prefix;
      if (!this.managedPaths.includes(prefix)) {
         this.managedPaths.push(prefix);
      }
   }

   /**
    * 启动物理监听（支持复用）
    */
   public async _start(options: { port?: number; host?: string }): Promise<void> {
      const addr = this.getListenAddr();
      let binding = HttpServerToolTransport.sharedServers.get(addr);

      if (!binding) {
         const server = http.createServer((req, res) => this.staticRequestListener(addr, req, res));
         binding = { server, refCount: 0, routes: new Map() };
         HttpServerToolTransport.sharedServers.set(addr, binding);

         const port = options.port !== undefined ? options.port : parseInt(addr.split(':').pop() || '3000');
         const host = options.host || (addr.startsWith(':') ? '0.0.0.0' : addr.split(':')[0]);

         try {
            await new Promise<void>((resolve, reject) => {
               binding!.server.on('error', reject);
               binding!.server.listen(port, host, () => {
                  binding!.server.off('error', reject);
                  resolve();
               });
            });
         } catch (err) {
            HttpServerToolTransport.sharedServers.delete(addr);
            throw err;
         }
      }

      // 注册当前实例的路由
      binding.refCount++;
      for (const path of this.getRoutes()) {
         binding.routes.set(path, this);
      }
      if (!binding.defaultInstance) binding.defaultInstance = this;
   }

   /**
    * 停止逻辑实例（自动处理物理 Server 关闭）
    */
   public async stop(force?: boolean): Promise<void> {
      const addr = this.getListenAddr();
      const binding = HttpServerToolTransport.sharedServers.get(addr);
      if (!binding) return;

      // 清理路由映射
      for (const path of this.getRoutes()) {
         binding.routes.delete(path);
      }
      if (binding.defaultInstance === this) {
         binding.defaultInstance = binding.routes.values().next().value;
      }

      binding.refCount--;
      if (binding.refCount <= 0) {
         HttpServerToolTransport.sharedServers.delete(addr);
         return new Promise((resolve, reject) => {
            if (force) binding.server.closeAllConnections();
            binding.server.close((err) => err ? reject(err) : resolve());
         });
      }
   }

   /**
    * 静态分发器：物理请求入口
    */
   private staticRequestListener(addr: string, req: http.IncomingMessage, res: http.ServerResponse) {
      const binding = HttpServerToolTransport.sharedServers.get(addr);
      if (!binding) return;

      const url = req.url || '/';
      const pathname = url.split('?')[0];
      // 归一化路径匹配：确保以 / 结尾以便进行前缀对比
      const normalizedPath = pathname.endsWith('/') ? pathname : pathname + '/';

      // 匹配最长前缀路由
      let bestMatch: HttpServerToolTransport | undefined;
      let longestPrefix = -1;

      for (const [prefix, instance] of binding.routes.entries()) {
         if (normalizedPath.startsWith(prefix) && prefix.length > longestPrefix) {
            longestPrefix = prefix.length;
            bestMatch = instance;
         }
      }

      const target = bestMatch || binding.defaultInstance;
      if (target) {
         target.handleInternalRequest(req, res);
      } else {
         res.statusCode = 404;
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

      // 1. Discovery Handler
      if (this.discoveryHandlerInfo && method === 'GET' && normalizedPath === this.discoveryHandlerInfo.prefix) {
         try {
            const result = this.discoveryHandlerInfo.handler();
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify(result));
         } catch (e: any) {
            this.sendError(res, 500, e.message);
         }
         return;
      }

      // 2. RPC Handler (基于 rpcPrefix 的业务流水线)
      if (this.rpcPrefix && normalizedPath.startsWith(this.rpcPrefix)) {
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

   protected async toRpcRequest(rawReq: http.IncomingMessage): Promise<ToolRpcRequest> {
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

      if (!toolId && rawReq.url) {
         const urlPath = rawReq.url.split('?')[0].substring(this.rpcPrefix.length);
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

      if (!toolId) {
         const err: any = new Error("Missing routing information: rpc-fn header or valid URL Path");
         err.status = 400;
         throw err;
      }

      const reqObj: ToolRpcRequest = {
         apiUrl: this.apiUrl || `http://${rawReq.headers.host}${this.rpcPrefix}`,
         toolId: toolId,
         act: act,
         resId: resId,
         traceId: headersStr[RPC_HEADERS.TRACE_ID],
         requestId: (headersStr[RPC_HEADERS.REQUEST_ID] as string) || randomUUID(),
         params: params,
         headers: headersStr,
         raw: { _req: rawReq, _res: null }
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
         req.on('data', chunk => body += chunk.toString());
         req.on('end', () => resolve(body));
         req.on('error', reject);
      });
   }

   public getRaw(): http.Server | undefined {
      const addr = this.getListenAddr();
      return HttpServerToolTransport.sharedServers.get(addr)?.server;
   }
}
