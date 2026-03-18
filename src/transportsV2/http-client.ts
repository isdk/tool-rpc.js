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

      if (act === 'get' || act === 'delete' || fetchOptions.method === 'GET') {
         reqOptions.method = (act === 'delete') ? 'DELETE' : 'GET';
         if (args) {
            const u = new URL(url);
            u.searchParams.append('p', typeof args === 'string' ? args : JSON.stringify(args));
            url = u.toString();
         }
      } else if (args) {
         reqOptions.body = typeof args === 'string' ? args : JSON.stringify(args);
      }

      const response = await fetch(url, reqOptions);
      if (response.status === 102) {
         return {
            status: 102,
            headers: Object.fromEntries(response.headers.entries())
         };
      }

      if (!response.ok && response.status !== 102) {
         let errMsg = response.statusText;
         try {
            const errBody = await response.json();
            if (errBody.error && errBody.error.message) {
               errMsg = errBody.error.message;
            } else if (errBody.error) {
               errMsg = errBody.error;
            }
         } catch { }
         throw new Error(`RPC Error [${response.status}]: ${errMsg}`);
      }
      return response;
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
