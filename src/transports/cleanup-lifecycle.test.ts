import { describe, it, expect, beforeEach } from 'vitest';
import { makeToolFuncLifecycle } from '@isdk/tool-func';
import { ServerTools } from '../server-tools';
import { RpcServerDispatcher } from './dispatcher';
import { RpcActiveTaskTracker } from './task-tracker';
import { RpcTaskResource } from './rpc-task';

/**
 * issue #14（a/b）：per-call `cleanup` 的 exactly-once 归 tool-func 的 lifecycle ability。
 *
 * RPC **不代装**这个能力——那是注册类自己的事，所以这里以「用户自己
 * `makeToolFuncLifecycle(ServerTools)`」的 posture 来测（这也是文档里写的姿势）。
 * 锁四件事：
 * 1. 一次调用只有一个调用作用域：`performExecution` 不能既 `with(context)` 又把 context
 *    当第二个参数递进去（那会让 tool-func 再开一层影子 → 作用域开两次 → cleanup 两次）；
 * 2. dispatcher 不得自己再调一次 `tool.cleanup(params, ctx)`：那条签名与 tool-func 的
 *    `cleanup(this)` 不是一个契约，挂了 ability 的类会永远多一次；
 * 3. 摘掉第二个参数之后，legacy compat 的 `_req` / `_res` / `_signal` 注入不能丢；
 * 4. 非 tool-func 的自定义注册表：RPC 不再代调它的 `cleanup`（释放是工具自己的事）。
 */

// ability 归位给用户：测试自己装，生产代码不装
makeToolFuncLifecycle(ServerTools);

const settle = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('per-call cleanup 的 exactly-once（issue #14）', () => {
  let tracker: RpcActiveTaskTracker;
  let dispatcher: RpcServerDispatcher;
  let api: RpcTaskResource;

  beforeEach(() => {
    ServerTools.items = {};
    tracker = new RpcActiveTaskTracker();
    dispatcher = new RpcServerDispatcher({ tracker });
    dispatcher.registry = ServerTools;
    api = new RpcTaskResource();
  });

  const base = {
    requestId: '',
    toolId: '',
    act: 'run',
    params: {},
    headers: {},
  } as any;

  it('1) 正常返回：cleanup 1 次，this 是执行体的影子实例', async () => {
    const seen: any[] = [];
    ServerTools.register({
      name: 'ok-tool',
      isApi: true,
      func: async function () {return 'v';},
      cleanup(this: any) {seen.push(this);},
    } as any);

    const res = await dispatcher.dispatch({ ...base, requestId: 'r-ok', toolId: 'ok-tool' });
    expect(res.status).toBe(200);
    expect(seen.length, 'cleanup 次数（exactly-once）').toBe(1);
    // cleanup 必须落在真正执行本次调用的那层，否则释放的不是这次申请的资源
    expect(Object.prototype.hasOwnProperty.call(seen[0], 'ctx'), 'this 应是影子实例').toBe(true);
    expect(seen[0]).not.toBe(ServerTools.get('ok-tool'));
    tracker.stop();
  });

  it('2) 执行体抛错：cleanup 仍 1 次', async () => {
    let n = 0;
    ServerTools.register({
      name: 'boom-tool',
      isApi: true,
      func: async function () {throw new Error('boom');},
      cleanup() {n++;},
    } as any);

    const res = await dispatcher.dispatch({ ...base, requestId: 'r-boom', toolId: 'boom-tool' });
    expect(res.status).toBe(500);
    expect(n, 'cleanup 次数（失败路径也要有且只有一次）').toBe(1);
    tracker.stop();
  });

  it('3) 客户端 $cancel：cleanup 1 次（旧行为 = 3 次）', async () => {
    let n = 0;
    ServerTools.register({
      name: 'bg-tool',
      isApi: true,
      timeout: { value: 50, keepAliveOnTimeout: true },
      func: async function (this: any) {
        const signal = this.ctx?.signal;
        return new Promise<string>((resolve, reject) => {
          const t = setTimeout(() => resolve('done'), 5000);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            const e: any = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          }, { once: true });
        });
      },
      cleanup() {n++;},
    } as any);

    const call = dispatcher.dispatch({ ...base, requestId: 'r-cancel', toolId: 'bg-tool' });
    await settle(120); // 已进后台态
    expect(tracker.get('r-cancel'), '取消前应在账本里').toBeDefined();

    api.$cancel({}, { resId: 'r-cancel', dispatcher } as any);
    await settle(80);
    expect(n, '$cancel 之后 cleanup 次数').toBe(1);
    await call;
    expect(n, '调用收尾后不得再补一次').toBe(1);
    tracker.stop();
  });

  it('4) 硬死线（Background Guard）中止：cleanup 1 次', async () => {
    let n = 0;
    ServerTools.register({
      name: 'slow-tool',
      isApi: true,
      timeout: { value: 40 }, // 不开 keepAlive：硬超时 → 408 并中止
      func: async function (this: any) {
        const signal = this.ctx?.signal;
        return new Promise<string>((resolve, reject) => {
          const t = setTimeout(() => resolve('done'), 5000);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            const e: any = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          }, { once: true });
        });
      },
      cleanup() {n++;},
    } as any);

    const res = await dispatcher.dispatch({ ...base, requestId: 'r-guard', toolId: 'slow-tool' });
    // 不开 keepAlive 的硬死线：不具备后台维持能力 → 504（见规范 §4）
    expect(res.status).toBe(504);
    await settle(30);
    expect(n, '硬死线中止也只许 1 次').toBe(1);
    tracker.stop();
  });

  it('5) 摘掉 context 双传之后，legacy compat 的 _req/_res/_signal 仍在 params 上', async () => {
    let got: any;
    ServerTools.register({
      name: 'compat-tool',
      isApi: true,
      func: async function (params: any) {got = params; return 'ok';},
    } as any);

    const rawReq = { url: '/api/compat-tool', method: 'POST' };
    const rawRes = { statusCode: 0 };
    await dispatcher.dispatch({
      ...base,
      requestId: 'r-compat',
      toolId: 'compat-tool',
      raw: { _req: rawReq, _res: rawRes },
    });

    expect(got._req, 'params._req').toBe(rawReq);
    expect(got._res, 'params._res').toBe(rawRes);
    expect(got._signal && typeof got._signal.addEventListener, 'params._signal').toBe('function');
    tracker.stop();
  });

  it('6) 非 tool-func 的自定义注册表：RPC 不代调它的 cleanup', async () => {
    let n = 0;
    // 自定义注册表（没有 lifecycle ability）：以前 dispatcher 会在中止时用 (params, ctx) 这个签名
    // 代调它的 `cleanup`，那是第二条契约。现在释放交还工具自己，RPC 一次都不调。
    const custom = {
      get: () => ({
        stream: false,
        timeout: { value: 50, keepAliveOnTimeout: true },
        // 不进后台就不收尾的任务（promise 永不结束），只能被 $cancel 掉
        async run() {return new Promise(() => {});},
        cleanup() {n++;},
      }),
    };

    const call = dispatcher.dispatch({ ...base, requestId: 'r-custom', toolId: 'x' }, custom as any);
    await settle(120); // 已进后台态
    expect(tracker.get('r-custom'), '取消前应在账本里').toBeDefined();

    api.$cancel({}, { resId: 'r-custom', dispatcher } as any);
    await settle(50);
    expect(n, 'dispatcher 不该代调自定义注册表的 cleanup').toBe(0);
    await call;
    tracker.stop();
  });
});
