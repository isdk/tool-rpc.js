import { describe, it, expect, beforeEach } from 'vitest';
import { createCallbacksTransformer } from '@isdk/tool-func';
import { ServerTools } from '../server-tools';
import { RpcServerDispatcher } from './dispatcher';
import { RpcActiveTaskTracker } from './task-tracker';
import { RpcTaskResource } from './rpc-task';

/**
 * issue #14 拆分项：流式工具的 `onClose(status, reason)`（tool-func 的流回调，
 * `'final' | 'error' | 'cancel'`）由**工具自己建流时**挂，与 lifecycle ability 无关。
 *
 * 这条今天就该成立：账本中止走 `RpcActiveTaskHandle` 的 `outputStream.cancel(reason)`，
 * 取消沿 pipe 链上传到工具那层 transformer 的 `cancel` → `onClose('cancel')`。
 * 它和 per-call `cleanup` 是两条互不相干的钩子，不能混在一条用例里断。
 */
const settle = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('流式工具 onClose(status) 与账本中止的联动（issue #14）', () => {
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

  /** 工具自己给流挂 onClose：这是 tool-func 的流回调，不是 RPC 的钩子 */
  function registerStreamTool(name: string, opts: { keepAlive?: boolean; close?: boolean } = {}) {
    ServerTools.register({
      name,
      isApi: true,
      stream: true,
      ...(opts.keepAlive ? { timeout: { value: 50, keepAliveOnTimeout: true } } : {}),
      func: async function () {
        const src = new ReadableStream({
          start(c) {
            c.enqueue('a');
            if (opts.close !== false) {
              // 让流自己收尾：走 'final' 那条路
              setTimeout(() => c.close(), 20);
            }
          },
        });
        return src.pipeThrough(createCallbacksTransformer({
          onClose: (status: any) => {events.push(status);},
        }));
      } as any,
    } as any);
  }

  let events: string[] = [];

  it('客户端取消后台中的流：onClose 收到 cancel，且只来一次', async () => {
    events = [];
    registerStreamTool('bg-stream', { keepAlive: true, close: false });

    const call = dispatcher.dispatch({
      requestId: 'r-stream-cancel', toolId: 'bg-stream', act: 'run', params: {}, headers: {},
    } as any);

    await settle(120); // 已进后台态，流还挂在账本上
    const handle = tracker.get('r-stream-cancel');
    expect(handle, '取消前应在账本里').toBeDefined();
    expect((handle as any).streamPending, '流应仍挂在账本上').toBe(true);

    api.$cancel({}, { resId: 'r-stream-cancel', dispatcher } as any);
    await settle(50);

    expect(events, '工具侧 onClose 的 status 序列').toEqual(['cancel']);
    await call;
    expect(events, '收尾不得再补一次 onClose').toEqual(['cancel']);
    tracker.stop();
  });

  it('对照：正常跑完的流是 final（证明上一条不是白断）', async () => {
    events = [];
    registerStreamTool('ok-stream');

    const res = await dispatcher.dispatch({
      requestId: 'r-stream-final', toolId: 'ok-stream', act: 'run', params: {}, headers: {},
    } as any);
    expect(res.status).toBe(200);
    // 把流读干，触发工具的收尾
    const reader = (res.data as ReadableStream).getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) {break;}
    }
    await settle(50);
    expect(events).toEqual(['final']);
    tracker.stop();
  });
});
