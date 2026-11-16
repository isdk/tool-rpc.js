import { AsyncFeatures, makeToolFuncCancelable, type TaskAbortController, type TaskPromise } from '@isdk/tool-func';
import { ClientTools } from './client-tools';
import { RPC_PARAM_KEYS } from './consts';

/**
 * `makeClientToolRpcCancelable` 的选项。
 */
export interface ClientToolCancelableOptions {
  /**
   * 同一个工具实例上的最大并发任务数（tool-func 的信号量）。
   * 不配 = 不限并发。需要「客户端限流」时用它，而不是自己排队。
   */
  maxTaskConcurrency?: number;
}

/**
 * 开了能力之后，调用面返回的是 `TaskPromise`（挂了 `task` 句柄）。
 * 没开过的类上没有这些成员——能力是 opt-in 的，类型上也得看得出来。
 */
export interface CancelableClientToolFunc {
  run(params?: any, ctx?: any): TaskPromise<any>;
  runSync(params?: any, ctx?: any): TaskPromise<any>;
  runWithPos?(...args: any[]): TaskPromise<any>;
  fetch(objParam?: any, act?: any, subName?: any, fetchOptions?: any): TaskPromise<any>;
}

export type WithCancelableRpc<T extends typeof ClientTools> = T & {
  new (...args: ConstructorParameters<T>): InstanceType<T> & CancelableClientToolFunc;
};

/**
 * 让一个 `ClientTools` 类的远程调用变成**可取消的异步任务**：
 * `run()` / `fetch()` 返回挂了 `task` 的 `TaskPromise`，`p.task.abort(reason)` 与本地调用同形。
 *
 * 它做两件 tool-func 那个注入器**不做**的事：
 *
 * 1. **注入能力**（`makeToolFuncCancelable`），并且默认 `MultiTask`。
 *    单任务模式对 RPC 客户端不可用：同一个 stub 上第二次并发 `run()` 会直接抛
 *    `The task is running`（见 tool-func `createAborter`）。
 * 2. **把 `func` / `fetch` 包进任务里**，并把内部 aborter 的 signal 灌给传输层。
 *    tool-func 的注入器只往类上塞方法，`func` 由工具作者自己写；而 `ClientTools.func`
 *    是框架写死的（转发到 `fetch`），发现出来的 stub 走的正是它——用户没有 `func` 可写。
 *
 * 第 2 件事才是关键：tool-func 的信号联动方向是**外部 → 内部**（`ctx.signal` 链进 aborter），
 * 它不会把 aborter 的 signal 写回 `ctx.signal`。不接这一根线，`p.task.abort()` 只断本地
 * promise，服务端照跑——就是 issue #11 那个「静默失效」换个人口。接上之后，取消走的是
 * 传输层已有的那条路：连接态切连接、曾回 `102` 则发 `$cancel`（SPEC §5.2），
 * 传输层以 `AbortError` 拒绝，外层 task 跟着拒绝。
 *
 * 不开这个能力，取消照样成立——调用方自己传 `fetchOptions.signal` 就行。
 * 这里加的只是「不必自己攒 AbortController」，以及任务池 / 超时定时器 / 外部信号解链
 * 这些由 tool-func 在任务收尾时统一清掉的东西。
 *
 * 注意：**不**把 `timeout` 交给 tool-func 的 aborter。RPC 的死线只有一套
 * （`rpc-timeout` header + 服务端 `RpcDeadlineGuard`，见 `tool-rpc-timeout-spec.cn.md`），
 * 再叠一层「整个任务链」的定时器就是第二套死线，两边会打架。`task.abort()` 只表示取消。
 *
 * @param Tool - 要开能力的 `ClientTools` 子类（每个类只包一次，重复调用是幂等的）。
 * @param options - 见 `ClientToolCancelableOptions`。
 * @returns 同一个类（类型上带上 `TaskPromise` 调用面）。
 *
 * @example
 * ```ts
 * class MyApi extends ClientTools {}
 * makeClientToolRpcCancelable(MyApi);
 * await MyApi.loadFrom();
 *
 * const p = MyApi.get('generate').run({ prompt });
 * setTimeout(() => p.task.abort('用户停止'), 5000); // 远程任务真的会停
 * ```
 */
export function makeClientToolRpcCancelable<T extends typeof ClientTools>(
  Tool: T,
  options?: ClientToolCancelableOptions,
): WithCancelableRpc<T> {
  makeToolFuncCancelable(Tool as any, {
    // 客户端一个 stub 天然并发：没有 MultiTask，第二次并发调用会被 aborter 挡掉
    asyncFeatures: AsyncFeatures.MultiTask,
    ...(options?.maxTaskConcurrency ? { maxTaskConcurrency: options.maxTaskConcurrency } : {}),
  });

  const proto = Tool.prototype as any;
  // 幂等：同一个类（或已包过的类的子类）重复调用只包一层
  if (proto.__clientToolRpcCancelable) {return Tool as unknown as WithCancelableRpc<T>;}
  proto.__clientToolRpcCancelable = true;

  const baseFetch = proto.fetch;

  proto.fetch = function (this: any, objParam?: any, act?: any, subName?: any, fetchOptions?: any): TaskPromise<any> {
    // 下面的 runTask 是箭头函数：它词法上就拿着这里的 `this`（本次调用的 runner，
    // 可能是 shadow 实例），不需要 `const self = this`。

    // `aborter` 是保留名（issue #15）：tool-func 要把本地任务句柄挂在 `params.aborter` 上。
    // 调用方拿它当业务参数时，往下走只会听到 tool-func 一句没头没尾的
    // `aborter should be an AbortController`——看不出自己踩了协议里的保留名。先一步说清。
    // 假值（包括 `0` / `''` / `null`）不算踩：注入的本地句柄本来就会被 `stripLocalAborter` 摘掉。
    if (objParam && typeof objParam === 'object' && !Array.isArray(objParam)
      && objParam[RPC_PARAM_KEYS.ABORTER]) {
      // 先把那个键摘掉再开任务（`runAsyncCancelableTask` 自己会先校 `params.aborter`，
      // 带着它进去就只能听到 tool-func 那句），保留 TaskPromise 的形状：`p.task` 仍在。
      const conflictParam = { ...objParam };
      delete conflictParam[RPC_PARAM_KEYS.ABORTER];
      return this.runAsyncCancelableTask(conflictParam, async () => {
        throw new Error(
          `params.${RPC_PARAM_KEYS.ABORTER} is reserved by makeClientToolRpcCancelable (it carries the local task handle). Rename your parameter.`)
      });
    }

    return this.runAsyncCancelableTask(objParam, async (params: any, aborter: TaskAbortController) => {
      // tool-func 把句柄挂在 params 上（`params.aborter = aborter`），而 RPC 的 params
      // 是要序列化发到服务端的：本地 AbortController 上 wire 会变成一个平白多出来的
      // `aborter: {}`，污染参数校验，还可能撞上服务端注入的 `_signal`。
      // 只摘 `aborter`：`timeout` / `signal` 这些名字可能是调用方真正的业务参数。
      const wireParams = stripLocalAborter(params);

      // 内部 aborter 与调用方自带的 signal 并联：只取一个就会漏另一侧的取消。
      const signal = mergeAbortSignals([aborter?.signal, fetchOptions?.signal, this.ctx?.signal]);
      try {
        return await baseFetch.call(this, wireParams, act, subName, signal ? { ...fetchOptions, signal } : fetchOptions);
      } finally {
        // 手工并联出来的那条 signal 挂着调用方 controller 上的监听器：调用一结束就摘，
        // 否则共享一个 AbortController 连发请求会在它身上永久累积监听器。
        (signal as any)?.__unlink?.();
      }
    });
  };

  // `func` 是 `run()` 的入口。基类那句 `const res = await this.fetch(...)` 会把 task 句柄
  // await 掉（await 之后拿到的是新的 promise，`task` 就没了），所以这里原样把 TaskPromise 交出去。
  proto.func = function (this: any, ...args: any[]) {
    return this.fetch(...args);
  };

  return Tool as unknown as WithCancelableRpc<T>;
}

/** 摘掉 tool-func 注入的本地句柄，别让它上 wire（见 `makeClientToolRpcCancelable`）。 */
function stripLocalAborter(params: any) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {return params;}
  if (!(RPC_PARAM_KEYS.ABORTER in params)) {return params;}
  const { [RPC_PARAM_KEYS.ABORTER]: _localAborter, ...rest } = params;
  return rest;
}

/**
 * 把多个 signal 并联成一个。没有任何 signal 时返回 `undefined`（让传输层按自己的默认值走）。
 *
 * `AbortSignal.any` 在 Node ≥20.3 / 现代浏览器里可用；没有它（旧浏览器）就手工并联，
 * 并在 signal 上挂一个 `__unlink`，由调用方在请求收尾时摘掉监听器。
 */
function mergeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const list: AbortSignal[] = [];
  for (const s of signals) {
    if (s && typeof s.aborted === 'boolean' && !list.includes(s)) {list.push(s);}
  }
  if (!list.length) {return undefined;}
  if (list.length === 1) {return list[0];}

  const anyFn = (AbortSignal as any)?.any;
  if (typeof anyFn === 'function') {
    try {
      return anyFn.call(AbortSignal, list);
    } catch {
      // 拿不到就退回手工并联：取消连线断了比多挂几个监听器严重得多
    }
  }

  const controller = new AbortController();
  const offs: Array<() => void> = [];
  for (const s of list) {
    if (s.aborted) {
      controller.abort((s as any).reason);
      break;
    }
    const relay = () => controller.abort((s as any).reason);
    s.addEventListener('abort', relay, { once: true });
    offs.push(() => s.removeEventListener('abort', relay));
  }
  (controller.signal as any).__unlink = () => {
    while (offs.length) {
      try {
        offs.shift()!();
      } catch {}
    }
  };
  return controller.signal;
}
