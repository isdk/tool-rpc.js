/**
 * `subscribe()` 异步化后，mailbox transport 必须把「订阅已生效」写进代码里
 *
 * v1 的 `subscribe()` 是同步的，所以这两个 transport 里两件事**成立但不是被写出来的**：
 *
 *   1. `stop()` 能退订：`this.subscription` 是个句柄。
 *   2. push 模式下「先订阅、再 drain 积压」：`drainBacklog` 跑起来时订阅已经生效。
 *
 * 第 2 条不是洁癖——`mailbox-transport.test.ts` 里那条集成断言钉着它：顺序反了，同一条请求
 * 会被 push 回调执行一遍、又被 `drainBacklog` 取出来执行第二遍（**副作用重复**）。
 * 异步化之后两条都会静默失效：字段是 `subscription: any`，所以 `this.subscription =
 * mailbox.subscribe(...)`（漏 await）连编译都不报，只在 `stop()` 时炸一句
 * `unsubscribe is not a function`，或者干脆默默把顺序丢掉。
 *
 * 于是这里补三件事：
 *   - 句柄形状：`await start()` 之后拿到的是 Subscription，不是 Promise（C1/S2）。
 *   - 顺序：`subscribe` 生效早于第一个 `fetch`（S1）。
 *   - **await 窗口里的 `stop()`**：`stop()` 看不见还没登记的订阅，必须由 `start()` 在
 *     订阅落地时收尾，不能留下一个没人认领的活订阅（C3/S3）。
 *   - 幂等：并发 `start()` 只建立一条订阅（C2）——`if (!this.subscription)` 那种双检在
 *     await 之后挡不住任何东西。
 */

import { describe, it, expect } from 'vitest';
import type { Mailbox, MailMessage, Subscription } from '@mboxlabs/mailbox';
import { MailboxClientTransport } from './mailbox-client';
import { MailboxServerTransport } from './mailbox-server';

/**
 * 只实现这两个 transport 真正会碰的 Mailbox 面，并记录**调用顺序**：
 * 顺序断言靠的就是 `order`，所以「订阅生效」要单独留一条记录（`subscribe-ready`）。
 */
class FakeMailbox {
  public order: string[] = [];
  public subscribeCalls = 0;
  public unsubscribeCalls = 0;
  /** true = `subscribe()` 要等一拍才落地（真实 broker 来回一趟）。 */
  public deferred = false;
  public queued: MailMessage[] = [];
  public posts: MailMessage[] = [];
  public armed = false;
  private release: (() => void) | null = null;

  public async start(): Promise<void> {
    this.order.push('mailbox-start');
  }

  public subscribe(address: unknown, _onReceive: unknown): Promise<Subscription> {
    this.subscribeCalls++;
    this.order.push('subscribe');
    const settle = (): Subscription => {
      this.armed = true;
      this.order.push('subscribe-ready');
      return {
        id: `sub-${this.subscribeCalls}`,
        address: address as URL,
        status: 'active',
        unsubscribe: async (): Promise<void> => {
          this.unsubscribeCalls++;
          this.armed = false;
          this.order.push('unsubscribe');
        },
      };
    };
    if (this.deferred) {
      return new Promise<Subscription>((resolve) => {
        this.release = () => resolve(settle());
      });
    }
    return Promise.resolve(settle());
  }

  /** provider 答话了。 */
  public settleSubscribe(): void {
    const release = this.release;
    this.release = null;
    release?.();
  }

  public async fetch(): Promise<MailMessage | null> {
    this.order.push('fetch');
    return this.queued.shift() ?? null;
  }

  public async post(message: MailMessage): Promise<MailMessage> {
    this.posts.push(message);
    return message;
  }

  public async stop(): Promise<void> {
    this.order.push('mailbox-stop');
  }

  public indexOfStep(step: string): number {
    return this.order.indexOf(step);
  }

  public asMailbox(): Mailbox {
    return this as unknown as Mailbox;
  }
}

/**
 * 等一个条件成立（1ms 一拍）。
 *
 * 不用 `await Promise.resolve()` 数微任务拍数：那种测试对「实现多一个 await」极度敏感，
 * 会把正确实现测成超时（而超时会让人去改实现，而不是改测试）。
 */
const until = async (predicate: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error(`等不到：${what}`)
}

const clientOf = (mailbox: FakeMailbox): MailboxClientTransport =>
  new MailboxClientTransport({
    mailbox: mailbox.asMailbox(),
    apiUrl: 'mem://server/api',
    clientAddress: 'mem://client/inbox',
  });

const serverOf = (mailbox: FakeMailbox): MailboxServerTransport => {
  const transport = new MailboxServerTransport({
    mailbox: mailbox.asMailbox(),
    apiUrl: 'mem://bot@mailbox/api/v1',
  });
  // 路由与派发不是本文件的主题
  (transport as any).dispatcher.dispatch = async () => ({ status: 200, data: 'ok' });
  return transport;
};

describe('MailboxClientTransport：订阅是 await 点', () => {
  it('[语义] C1 await start() 之后拿到的是 Subscription 句柄，stop() 才退得掉', async () => {
    const mailbox = new FakeMailbox();
    const transport = clientOf(mailbox);

    await transport.start();
    const subscription = (transport as any).subscription as Subscription;
    // 不是 Promise：否则 stop() 只会炸一句 unsubscribe is not a function
    expect(typeof subscription?.unsubscribe).toBe('function');
    expect(mailbox.subscribeCalls).toBe(1);

    await transport.stop();
    expect(mailbox.unsubscribeCalls).toBe(1);
  })

  it('[语义] C2 并发 start() 只建立一条订阅（异步之后 `if (!this.subscription)` 挡不住）', async () => {
    const mailbox = new FakeMailbox();
    mailbox.deferred = true;
    const transport = clientOf(mailbox);

    const starts = Promise.all([transport.start(), transport.start(), transport.start()]);
    await until(() => mailbox.subscribeCalls > 0, 'client subscribe 已发起')
    mailbox.settleSubscribe();
    await starts;

    expect(mailbox.subscribeCalls).toBe(1);
    expect(mailbox.armed).toBe(true);
    await transport.stop();
    expect(mailbox.unsubscribeCalls).toBe(1);
  })

  it('[语义] C3 订阅还在 await 里时 stop()：不得留下一个没人认领的活订阅', async () => {
    const mailbox = new FakeMailbox();
    mailbox.deferred = true;
    const transport = clientOf(mailbox);

    const starting = transport.start();
    await until(() => mailbox.subscribeCalls > 0, 'client subscribe 已发起')
    await transport.stop(); // 这一刻 this.subscription 还是空：stop() 无从下手
    mailbox.settleSubscribe(); // broker 迟到的回话
    await starting;

    expect(mailbox.subscribeCalls).toBe(1);
    expect(mailbox.unsubscribeCalls).toBe(1); // 由 start() 收尾补退
    expect(mailbox.armed).toBe(false);
    expect((transport as any).subscription).toBeFalsy();
  })
})

describe('MailboxServerTransport（push 模式）：先订阅，再清积压', () => {
  it('[语义] S1 第一个 fetch 必须晚于「订阅已生效」', async () => {
    const mailbox = new FakeMailbox();
    mailbox.deferred = true;
    const transport = serverOf(mailbox);

    const starting = transport._start({ address: 'mem://bot@mailbox/api/v1' });
    await until(() => mailbox.subscribeCalls > 0, 'server subscribe 已发起')
    mailbox.settleSubscribe();
    await starting;

    const ready = mailbox.indexOfStep('subscribe-ready');
    const firstFetch = mailbox.indexOfStep('fetch');
    expect(ready).toBeGreaterThanOrEqual(0);
    expect(firstFetch).toBeGreaterThanOrEqual(0);
    // 反了就是重复执行：drain 取出的那条，push 回调也已经收到过
    expect(firstFetch).toBeGreaterThan(ready);
    await transport.stop();
  })

  it('[语义] S2 await _start() 之后是句柄，stop() 退订一次', async () => {
    const mailbox = new FakeMailbox();
    const transport = serverOf(mailbox);

    await transport._start({ address: 'mem://bot@mailbox/api/v1' });
    const subscription = (transport as any).subscription as Subscription;
    expect(typeof subscription?.unsubscribe).toBe('function');

    await transport.stop();
    expect(mailbox.unsubscribeCalls).toBe(1);
    expect(mailbox.armed).toBe(false);
  })

  it('[语义] S3 订阅还在 await 里时 stop()：补退，且不再 drain（实例已在收尾）', async () => {
    const mailbox = new FakeMailbox();
    mailbox.deferred = true;
    mailbox.queued = [{ id: 'backlog-1' } as unknown as MailMessage];
    const transport = serverOf(mailbox);

    const starting = transport._start({ address: 'mem://bot@mailbox/api/v1' });
    await until(() => mailbox.subscribeCalls > 0, 'server subscribe 已发起')
    await transport.stop();
    mailbox.settleSubscribe();
    await starting;

    expect(mailbox.unsubscribeCalls).toBe(1);
    expect(mailbox.armed).toBe(false);
    expect((transport as any).subscription).toBeFalsy();
    // stop 之后还去 drain，就是给一个已经不收请求的实例喂积压
    expect(mailbox.indexOfStep('fetch')).toBe(-1);
  })

  it('[语义] S4 并发 _start 排队建立：最后只留一条活订阅', async () => {
    const mailbox = new FakeMailbox();
    const transport = serverOf(mailbox);

    const starts = Promise.all([
      transport._start({ address: 'mem://bot@mailbox/api/v1' }),
      transport._start({ address: 'mem://bot@mailbox/api/v1' }),
    ])
    // 排队：第一次先建立，第二次是重启 —— 两次都要等 provider 答话
    await until(() => mailbox.subscribeCalls > 0, '第一次 subscribe 已发起')
    mailbox.settleSubscribe()
    await until(() => mailbox.subscribeCalls > 1, '第二次 subscribe 已发起')
    mailbox.settleSubscribe()
    await starts

    // 排队 = 第二次是「重启」：必须先把第一次拆掉，不能两条同时活着（每条请求会被派两次）
    expect(mailbox.subscribeCalls - mailbox.unsubscribeCalls).toBe(1)
    expect(mailbox.armed).toBe(true)
    await transport.stop()
    expect(mailbox.armed).toBe(false)
    expect(mailbox.subscribeCalls - mailbox.unsubscribeCalls).toBe(0)
  })

  it('[事实] 重启（stop 后 start）重新建立订阅，不退化成旧句柄', async () => {
    const mailbox = new FakeMailbox();
    const transport = serverOf(mailbox);

    await transport._start({ address: 'mem://bot@mailbox/api/v1' });
    await transport.stop();
    await transport._start({ address: 'mem://bot@mailbox/api/v1' });

    expect(mailbox.subscribeCalls).toBe(2);
    expect(mailbox.unsubscribeCalls).toBe(1);
    expect(mailbox.armed).toBe(true);
    await transport.stop();
    expect(mailbox.unsubscribeCalls).toBe(2);
  })
})
