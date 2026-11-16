import { describe, expect, it } from 'vitest';
import { ClientToolTransport } from './client';
import { RPC_HEADERS } from './models';

/**
 * 取消通知（`$cancel`）必须真的发得出去（issue #11）。
 *
 * `executeWithPolling` 的 abortListener 是在**调用方的 signal 已经 abort 之后**才跑的那一段：
 * 它复用的那份 fetchOptions 里带着同一个已 abort 的 signal，而
 * - HTTP 会把它接到请求的 AbortController 上（`http-client.ts`），
 * - mailbox 见到 aborted 的 signal 直接拒绝（`mailbox-client.ts`），
 * 外面那层 `.catch(() => {})` 又把 rejection 吞掉 —— 于是服务端什么都不知道，任务照跑。
 *
 * 这里用探针 transport 盯住**为 `$cancel` 发出去的那一次调用拿到了什么 options**：
 * 带已 abort 的 signal = 当场死；继承业务死线 = 在软超时那么短的时间里再赌一次。
 */
class ProbeTransport extends ClientToolTransport {
  public calls: Array<{ name: string, act?: any, id?: any, fetchOptions: any }> = [];

  async _fetch(name: string, args: any, act: any, id: any, fetchOptions: any) {
    this.calls.push({ name, act, id, fetchOptions });
    // 取消通知：像服务端那样立刻应答
    if (act === '$cancel') {return { status: 200, body: { success: true } };}
    // 业务调用与状态轮询：始终留在后台态，把调用方钉在轮询循环里
    return { status: 102, headers: { [RPC_HEADERS.RETRY_AFTER]: '30' } };
  }

  async toObject(res: any) {
    return res;
  }
}

describe('client cancel notification ($cancel) — issue #11', () => {
  it('carries no already-aborted signal and no business deadline', async () => {
    const transport = new ProbeTransport('mem://probe/api');
    const controller = new AbortController();

    // 业务死线故意给得比取消动作还短：若 $cancel 继承它，这条通知就自己把自己切了
    const call = transport.fetch('slow', {}, 'run', undefined, {
      signal: controller.signal,
      timeout: 40,
    });

    // 已进入 102 轮询（retry-after 30ms 一轮）
    await new Promise(r => setTimeout(r, 25));
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });

    const cancelCall = transport.calls.filter(c => c.act === '$cancel').pop();
    expect(cancelCall, 'abort 后应当为 $cancel 发过一次请求').toBeDefined();
    // 已 abort 的 signal 会让这条通知在传输层当场死掉（HTTP 接线 / mailbox 前置判定）
    expect(cancelCall!.fetchOptions.signal?.aborted, '$cancel 不能再带已 abort 的 signal').toBeFalsy();
    // 调用已经结束了，业务死线不该再管这条通知的生死
    expect(cancelCall!.fetchOptions.timeout, '$cancel 不继承业务死线，走传输层自己的默认值').toBeUndefined();
    // 但它仍要认得那一个任务：res-id 就是客户端持有的 req-id
    expect(transport.calls[0].fetchOptions.headers[RPC_HEADERS.REQUEST_ID]).toBe(cancelCall!.id);
  });

  it('keeps the caller-supplied req-id as the cancel target', async () => {
    const transport = new ProbeTransport('mem://probe/api');
    const controller = new AbortController();
    const reqId = 'caller-owned-req-id';

    const call = transport.fetch('slow', {}, 'run', undefined, {
      signal: controller.signal,
      headers: { [RPC_HEADERS.REQUEST_ID]: reqId },
    });

    await new Promise(r => setTimeout(r, 25));
    controller.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });

    const cancelCall = transport.calls.filter(c => c.act === '$cancel').pop();
    expect(cancelCall?.id).toBe(reqId);
  });
});
