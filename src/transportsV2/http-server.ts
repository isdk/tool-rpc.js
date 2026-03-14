import http from 'http';
import { URL } from 'url';
import { Readable } from 'stream';
import { ServerToolTransport } from './server';
import { defaultsDeep } from 'lodash-es';
import { ToolRpcRequest, ToolRpcResponse, RPC_HEADERS, RpcStatusCode } from './models';
import { randomUUID } from 'crypto';

export class HttpServerToolTransport extends ServerToolTransport {
   public server: http.Server;
   private discoveryHandlerInfo: { prefix: string; handler: () => any } | null = null;
   private rpcPrefix: string = '';

   constructor(options?: http.ServerOptions & { dispatcher?: any }) {
      super(options);
      if (options) {
         // Exclude our custom options to avoid polluting http.createServer
         const { dispatcher, ...httpOptions } = options;
         this.server = http.createServer(httpOptions, this.requestListener.bind(this));
      } else {
         this.server = http.createServer(this.requestListener.bind(this));
      }
   }

   public addDiscoveryHandler(apiUrl: string, handler: () => any): void {
      const url = new URL(apiUrl);
      this.discoveryHandlerInfo = { prefix: url.pathname, handler };
   }

   public addRpcHandler(apiUrl: string, options?: any) {
      const url = new URL(apiUrl);
      let prefix = url.pathname;
      if (!prefix.endsWith('/')) {
         prefix += '/';
      }
      this.rpcPrefix = prefix;
   }

   private async requestListener(req: http.IncomingMessage, res: http.ServerResponse) {
      const { url, method } = req;
      if (!url) {
         return this.sendError(res, 400, 'Bad Request');
      }

      // Discovery Handler
      if (this.discoveryHandlerInfo && method === 'GET' && url === this.discoveryHandlerInfo.prefix) {
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

      // RPC Handler
      if (this.rpcPrefix && url.startsWith(this.rpcPrefix)) {
         // Send to standard template method
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

      // 瀑布流拦截: x-rpc-func -> url path
      let toolId = headersStr[RPC_HEADERS.TOOL_ID] || headersStr[RPC_HEADERS.FUNC];
      let act = headersStr[RPC_HEADERS.ACT];
      let resId = headersStr[RPC_HEADERS.RES_ID];

      // 若未发现强指定的控制头，才进行基于 HTTP Path 的降级猜测
      if (!toolId && rawReq.url) {
         const urlPath = rawReq.url.split('?')[0].substring(this.rpcPrefix.length);
         const parts = urlPath.split('/').map(s => s === undefined ? s : decodeURIComponent(s)).filter(Boolean);
         if (parts.length > 0) {
            toolId = parts[0];
            if (parts.length > 1 && resId === undefined) {
               resId = parts[1]; // resource :id (仅当 Header 中没有时才使用路径中的 ID)
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
         const err: any = new Error("Missing routing information: x-rpc-func header or valid URL Path");
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

      // 优先处理 102 信号 (Background/Processing 状态不是错误，仅作为中间状态标志)
      if (rpcRes.status === 102 || rpcRes.status === RpcStatusCode.PROCESSING) {
         // [V2 HTTP COMPAT] 物理层映射：102 是信息性状态码，由于 Node.js fetch (undici) 会在处理完 1xx 后期望后续
         // 真正的最终响应，如果此时直接 end() 会导致连接中断。
         // 映射为 202 Accepted 可确保现代 fetch 正确接收到“已接受并处理中”的信息。
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
      } else if (result && typeof (Readable as any).fromWeb === 'function' && result instanceof ReadableStream) {
         (Readable as any).fromWeb(result).pipe(rawRes);
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

   public async _start(options: { port: number; host?: string }): Promise<void> {
      const { port, host = '0.0.0.0' } = defaultsDeep(options, { port: 3000 });
      return new Promise((resolve, reject) => {
         this.server.on('error', (err) => {
            reject(err);
         });
         this.server.listen(port, host, () => {
            resolve();
         });
      });
   }

   public async stop(force?: boolean): Promise<void> {
      return new Promise((resolve, reject) => {
         if (!this.server || !this.server.listening) {
            return resolve();
         }
         if (force) {
            this.server.closeAllConnections();
         }
         this.server.close((err) => {
            if (err) {
               return reject(err);
            }
            resolve();
         });
      });
   }

   public getRaw(): http.Server {
      return this.server;
   }
}
