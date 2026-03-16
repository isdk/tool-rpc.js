import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcActiveTaskTracker, RpcActiveTaskHandle } from './task-tracker';
import { RpcTaskRetentionMode, RpcStatusCode } from './models';

describe('RpcActiveTaskTracker & Handle', () => {
  let tracker: RpcActiveTaskTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new RpcActiveTaskTracker(5000); // 5s TTL
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  const createHandle = (id: string, promise: Promise<any>, retention?: any) => {
    return new RpcActiveTaskHandle(
      id,
      promise,
      new AbortController(),
      false,
      () => {},
      retention
    );
  };

  it('should clean up task immediately when retention mode is None', async () => {
    const p = Promise.resolve('done');
    const handle = createHandle('task-none', p, RpcTaskRetentionMode.None);
    tracker.add('task-none', handle);

    await p;
    expect(handle.status).toBe('completed');
    expect(handle.shouldCleanup(Date.now())).toBe(true);
  });

  it('should keep task when retention mode is Permanent', async () => {
    const p = Promise.resolve('done');
    const handle = createHandle('task-perm', p, RpcTaskRetentionMode.Permanent);
    tracker.add('task-perm', handle);

    await p;
    // Advance 1 hour
    vi.advanceTimersByTime(3600000);
    expect(handle.shouldCleanup(Date.now())).toBe(false);
  });

  it('should clean up task after one fetch when mode is Once', async () => {
    const p = Promise.resolve('done');
    const handle = createHandle('task-once', p, 'once');
    tracker.add('task-once', handle);

    await p;
    expect(handle.shouldCleanup(Date.now())).toBe(false); // No fetch yet

    handle.fetchCount = 1;
    expect(handle.shouldCleanup(Date.now())).toBe(true);
  });

  it('should clean up task after specific duration', async () => {
    const p = Promise.resolve('done');
    const handle = createHandle('task-timed', p, 1000); // 1s retention
    tracker.add('task-timed', handle);

    await p;
    vi.advanceTimersByTime(500);
    expect(handle.shouldCleanup(Date.now())).toBe(false);

    vi.advanceTimersByTime(600);
    expect(handle.shouldCleanup(Date.now())).toBe(true);
  });

  it('should abort and remove task when TTL expires', async () => {
    let aborted = false;
    const aborter = new AbortController();
    aborter.signal.addEventListener('abort', () => { aborted = true; });

    const handle = new RpcActiveTaskHandle(
      'task-ttl',
      new Promise(() => {}), // Hanging
      aborter,
      false,
      () => {}
    );
    tracker.add('task-ttl', handle);

    // Advance past tracker's sweep interval (60s) and TTL (5s)
    vi.advanceTimersByTime(70000);

    expect(tracker.get('task-ttl')).toBeUndefined();
    expect(aborted).toBe(true);
    expect(handle.status).toBe('aborted');
  });

  it('should prevent duplicate requestId registration', () => {
    const h1 = createHandle('dup', Promise.resolve());
    const h2 = createHandle('dup', Promise.resolve());
    
    tracker.add('dup', h1);
    expect(() => tracker.add('dup', h2)).toThrow(/already in use/);
  });

  it('should touch and extend TTL when accessed', () => {
    const handle = createHandle('task-touch', new Promise(() => {}));
    tracker.add('task-touch', handle);

    const initialAccess = handle.lastAccessed;
    vi.advanceTimersByTime(1000);
    
    tracker.get('task-touch');
    expect(handle.lastAccessed).toBeGreaterThan(initialAccess);
  });
});
