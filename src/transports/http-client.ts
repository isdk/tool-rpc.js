import { ClientToolTransport, ClientToolTransportOptions } from "./client";
import { ActionName } from "../consts";
import { RPC_HEADERS } from "./models";

export interface HttpClientToolTransportOptions extends ClientToolTransportOptions {
}

/**
 * 下游 cancel 时跑 `onCancel`，并把 cancel 继续往上游传（还是会让 undici 断开响应体）。
 *
 * 为什么必须自己包一层：规范里唯一保证被调用的 cancel 钩子是自建 ReadableStream 的
 * `underlyingSource.cancel`。`TransformStream` 的 `flush` 在 cancel 时不跑；它的第三个参数
 * `readableStrategy` 走 `ConvertAndNormalizeQueuingStrategy`，只读 `highWaterMark`/`size`，
 * 传 `cancel` 会被默默忽略（Node 22 实测不触发）。
 */
function cancelAware<T>(source: ReadableStream<T>, onCancel: () => void): ReadableStream<T> {
   const reader = source.getReader();
   return new ReadableStream<T>({
      pull(controller) {
         return reader.read().then(({ value, done }) => {
            if (done) {
               controller.close();
               return;
            }
            controller.enqueue(value);
         });
      },
      cancel(reason) {
         onCancel();
         return reader.cancel(reason);
      }
   });
}

export class HttpClientToolTransport extends ClientToolTransport {

   constructor(apiUrl: string, options?: HttpClientToolTransportOptions) {
      super(apiUrl, options);
   }

   public async _fetch(name: string, args?: any, act?: ActionName | string, id?: any, fetchOptions: any = {}) {
      let url = this.apiUrl;
      if (id != null && typeof id !== 'string') { id = JSON.stringify(id) }

      const headersstr: Record<string, string> = { ...fetchOptions.headers };

      // Inject standard routing headers (The essence of V2 Transport decoupling!)
      if (name) headersstr[RPC_HEADERS.FUNC] = name;
      if (act) headersstr[RPC_HEADERS.ACT] = act as string;
      if (id) headersstr[RPC_HEADERS.RES_ID] = id;

      // We can also append to URL if it's HTTP for better DX and backward compat
      // This helps Server side fallback extracting if other servers are not fully V2
      if (url.startsWith('http')) {
         try {
            const u = new URL(url);
            let p = u.pathname;
            if (!p.endsWith('/')) p += '/';

            if (name) {
               p += encodeURIComponent(name);
               if (id) {
                  p += '/' + encodeURIComponent(id);
               }
            }

            // Reconstruct URL to preserve origin and query/hash
            // Note: URL constructor does not double-encode paths passed as string
            const newUrl = new URL(p, u.origin);
            newUrl.search = u.search;
            newUrl.hash = u.hash;
            url = newUrl.toString();
         } catch (e) {
            // Fallback to simple concatenation if URL parsing fails (should be rare)
            if (!url.endsWith('/')) url += '/';
            if (name) {
               url += encodeURIComponent(name);
               if (id) {
                  url += '/' + encodeURIComponent(id);
               }
            }
         }
      }

      let reqOptions: any = {
         method: 'POST',
         headers: headersstr
      };

      if (!headersstr['Content-Type']) {
         headersstr['Content-Type'] = 'application/json';
      }

      if (act === 'get' || act === 'delete' || act === 'list' || fetchOptions.method === 'GET') {
         reqOptions.method = (act === 'delete') ? 'DELETE' : 'GET';
         if (args) {
            const u = new URL(url);
            u.searchParams.append('p', typeof args === 'string' ? args : JSON.stringify(args));
            url = u.toString();
         }
      } else if (args) {
         reqOptions.body = typeof args === 'string' ? args : JSON.stringify(args);
      }

      // [Client-side Timeout & Signal Handling]
      let timeoutId: any;
      const controller = new AbortController();

      if (fetchOptions.signal) {
         // `once`: 触发后自动摘除。调用方共享一个 AbortController 连发请求时，
         // 不加就会在它身上永久累积监听器（Node 会报 EventTarget 监听器泄漏告警）
         fetchOptions.signal.addEventListener('abort', () => controller.abort(fetchOptions.signal.reason), { once: true });
      }

      reqOptions.signal = controller.signal;

      let timeoutVal = fetchOptions.timeout;
      if (typeof timeoutVal === 'object' && timeoutVal !== null) timeoutVal = timeoutVal.value;
      if (timeoutVal) {
         timeoutId = setTimeout(() => {
            const err = new Error('Request Timeout');
            (err as any).code = 504;
            controller.abort(err);
         }, Number(timeoutVal));
      }

      try {
         const response = await fetch(url, reqOptions);
         clearTimeout(timeoutId);

         if (response.status === 102) {
            return {
               status: 102,
               headers: Object.fromEntries(response.headers.entries())
            };
         }

         // [202 Accepted → 102 Processing]
         // The server maps 102 (PROCESSING) to 202 (Accepted) for HTTP semantics.
         // Check the body — if it contains status: 102, treat it as a processing
         // response to trigger the executeWithPolling polling loop.
         if (response.status === 202) {
            try {
               const cloned = response.clone();
               const body = await cloned.json();
               if (body && body.status === 102) {
                  const headers: Record<string, string> = {};
                  response.headers.forEach((v, k) => { headers[k] = v; });
                  // Merge any headers from the 102 body (e.g. rpc-retry-after, rpc-request-id)
                  if (body.headers && typeof body.headers === 'object') {
                     for (const [k, v] of Object.entries(body.headers)) {
                        headers[k] = String(v);
                     }
                  }
                  return { status: 102, headers };
               }
            } catch {
               // Not JSON or not a 102 body — fall through to normal handling
            }
         }

         if (!response.ok && response.status !== 102) {
            let errMsg = response.statusText;
            let errDetails: any = {};
            try {
               const errBody = await response.json();
               if (errBody.error && typeof errBody.error === 'object') {
                  errMsg = errBody.error.message || errMsg;
                  errDetails = errBody.error;
               } else if (errBody.error) {
                  errMsg = String(errBody.error);
               }
            } catch { }

            const error: any = new Error(`RPC Error [${response.status}]: ${errMsg}`);
            error.code = errDetails.code || response.status;
            error.status = errDetails.status || 'error';
            error.data = errDetails.data;
            if (errDetails.name) error.name = errDetails.name;

            throw error;
         }

         // [Stream Idle Timeout Enforcement]
         const idleTimeoutVal = (typeof fetchOptions.timeout === 'object') ? fetchOptions.timeout.streamIdleTimeout : undefined;
         if (idleTimeoutVal && response.body) {
            let idleTimer: any;
            const resetIdleTimer = (controller: TransformStreamDefaultController) => {
               if (idleTimer) clearTimeout(idleTimer);
               idleTimer = setTimeout(() => {
                  controller.error(new Error(`Idle Timeout (${idleTimeoutVal}ms)`));
               }, Number(idleTimeoutVal));
            };

            // 下游 cancel 时定时器必须清，否则它活到 idle 超时才在 `controller.error` 上触发。
            // 但两个「看起来能接 cancel」的地方都不行（实测 + 规范）：
            //   - `flush`：cancel 不跑 flush；
            //   - `new TransformStream(transformer, writableStrategy, readableStrategy)` 的第三个参数：
            //     规范里它走 `ConvertAndNormalizeQueuingStrategy`，只读 `highWaterMark`/`size`，
            //     `cancel` 直接被忽略（lib.dom 把它定成没有 cancel 的 `QueuingStrategy` 是对的）。
            // 规范保证会调的只有自建 `ReadableStream` 的 `underlyingSource.cancel`，所以包一层。
            const transformer = new TransformStream({
               start(controller) {
                  resetIdleTimer(controller);
               },
               transform(chunk, controller) {
                  resetIdleTimer(controller);
                  controller.enqueue(chunk);
               },
               flush() {
                  if (idleTimer) clearTimeout(idleTimer);
               }
            });

            const originalStream = response.body;
            const monitoredStream = cancelAware(originalStream.pipeThrough(transformer), () => {
               if (idleTimer) clearTimeout(idleTimer);
            });

            // Re-wrap in Response to preserve headers
            return new Response(monitoredStream, {
               status: response.status,
               statusText: response.statusText,
               headers: response.headers
            });
         }

         return response;
      } catch (err: any) {
         clearTimeout(timeoutId);
         throw err;
      }
   }

   public async toObject(res: any, args?: any): Promise<any> {
      // Pass raw 102 back up to ClientToolTransport for executeWithPolling handling
      if (res && res.status === 102) return res;

      const contentType = res?.headers?.get?.('content-type');
      if (contentType && contentType.includes('application/json')) {
         return res.json();
      }
      return res.text();
   }
}
