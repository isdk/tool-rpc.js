import { ClientToolTransport, ClientToolTransportOptions } from "./client";
import { ActionName } from "../consts";
import { RPC_HEADERS } from "./models";

export interface HttpClientToolTransportOptions extends ClientToolTransportOptions {
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
         fetchOptions.signal.addEventListener('abort', () => controller.abort(fetchOptions.signal.reason));
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

            // Handle stream cancelation (if downstream cancels, we should clear timer)
            const originalStream = response.body;
            const monitoredStream = originalStream.pipeThrough(transformer);

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
