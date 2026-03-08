import { createError } from "@isdk/common-error";
import { Funcs } from '@isdk/tool-func';
import { ActionName } from '../consts';
import { genUrlParamsStr } from "./gen-url-params";
import { ClientToolTransport } from "./client";

/**
 * A concrete client transport implementation that uses the browser/node `fetch` API.
 */
export class HttpClientToolTransport extends ClientToolTransport {

  /**
   * Connects to the server's discovery endpoint to get the list of available tools.
   * @param options Additional options for the discovery call.
   * @returns A promise that resolves to a map of tool function metadata.
   */
  async loadApis(options?: any): Promise<Funcs> {
    const fetchOptions = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    const res = await this._fetch('', undefined, 'get', undefined, fetchOptions);
    const items = await res.json();
    return items;
  }

  async _fetch(name: string, args?: any, act?: ActionName | string, subName?: any, fetchOptions?: any) {
    const HasContentMethods = ['post', 'put', 'patch']
    if (!act) { act = this.Tools.action || 'post'}
    if (act === 'res') { act = 'get' }

    if ((!fetchOptions.headers || !fetchOptions.headers['Content-Type']) && HasContentMethods.includes(act)) {
      fetchOptions.headers = {
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      }
    }

    // Translate clientId from options to a request header
    if (fetchOptions?.clientId) {
      if (!fetchOptions.headers) {
        fetchOptions.headers = {};
      }
      fetchOptions.headers['x-client-id'] = fetchOptions.clientId;
      delete fetchOptions.clientId;
    }

    if (args?.stream && !fetchOptions.headers.Connection) {
      fetchOptions.headers.Connection = 'keep-alive'
    }
    if (subName) {
      if (typeof subName !== 'string') {subName = JSON.stringify(subName)}
      if (name) {subName = name + '/' + subName}
    } else {
      subName = name
    }

    fetchOptions.method =act.toUpperCase()
    let urlPart: string
    if (act === 'get' || act === 'delete') {
      urlPart  = subName + genUrlParamsStr(args)
    } else {
      fetchOptions.body = JSON.stringify(args)
      urlPart = subName!
    }

    if (fetchOptions.headers && !HasContentMethods.includes(act)) {
      delete fetchOptions.headers['Content-Type']
    }

    const fullUrl = urlPart ? `${this.apiRoot}/${urlPart}` : this.apiRoot;

    let timeoutVal: number | undefined;
    if (fetchOptions.timeout) {
      timeoutVal = typeof fetchOptions.timeout === 'number' ? fetchOptions.timeout : fetchOptions.timeout.value;
      if (timeoutVal) {
        if (!fetchOptions.headers) { fetchOptions.headers = {}; }
        fetchOptions.headers['x-rpc-timeout'] = timeoutVal.toString();

        if (!fetchOptions.signal) {
          const controller = new AbortController();
          fetchOptions.signal = controller.signal;
          // Add a small buffer to client local timeout to receive server 504
          const clientLocalTimeout = timeoutVal + 200;
          setTimeout(() => {
            if (!controller.signal.aborted) {
              controller.abort();
            }
          }, clientLocalTimeout);
        }
      }
    }

    const res = await fetch(fullUrl, fetchOptions)
    if (!res.ok) {
      const err = await this.errorFrom(name, res)
      throw err
    }

    if (args?.stream && fetchOptions.timeout?.streamIdleTimeout) {
      return this.wrapStreamWithIdleTimeout(res, fetchOptions.timeout.streamIdleTimeout);
    }
    return res
  }

  /**
   * Wraps a response with a stream idle timeout.
   * @param res - The response to wrap.
   * @param idleTimeout - The idle timeout in milliseconds.
   * @returns A response with a wrapped stream.
   */
  private wrapStreamWithIdleTimeout(res: any, idleTimeout: number) {
    if (!res.body) return res;

    const reader = res.body.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        let timer: any;

        const resetTimer = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            const err: any = new Error('Stream Idle Timeout');
            err.code = 'TIMEOUT';
            controller.error(err);
            reader.cancel();
          }, idleTimeout);
        };

        resetTimer();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (timer) clearTimeout(timer);
              controller.close();
              break;
            }
            resetTimer();
            controller.enqueue(value);
          }
        } catch (err) {
          if (timer) clearTimeout(timer);
          controller.error(err);
        }
      }
    });

    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  /**
   * @internal
   * A helper to create a structured error from a failed `fetch` response.
   * @param res - The HTTP response.
   * @returns A structured error object.
   */
  async errorFrom(name: string, res: Response) {
    let errCode = res.status
    let errMsg = res.statusText
    let data: any
    if (res.body) {
      const text = await res.text()
      try {
        const body = JSON.parse(text)
        if (body) {
          if (body.error) {errMsg = body.error}
          if (body.name) {name = body.name}
          if (body.data) {
            data = body.data
            data.name = name
            if (data.what) {
              data.msg = errMsg
              errMsg = data.what
            }
          }
          if (body.message) {
            errMsg = errMsg + ':' + body.message;
          }
        }
      } catch (e) {
        console.warn('🚀 ~ parse error body to json:', e)
      }
    }
    return createError(errMsg, name, errCode)
  }

  async toObject(res: any, args?: any) {
    return await res.json()
  }
}
