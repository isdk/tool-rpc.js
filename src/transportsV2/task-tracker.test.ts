import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcActiveTaskTracker, RpcActiveTaskHandle } from './task-tracker';
import { RpcTaskRetentionMode } from './models';

describe('RpcActiveTaskTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should add and retrieve a task, updating its TTL', () => {
    const tracker = new RpcActiveTaskTracker();
    const mockPromise = Promise.resolve();
    const aborter = new AbortController();
    const handle = new RpcActiveTaskHandle('test-1', mockPromise, aborter, false, () => { });

    const beforeTouch = handle.lastAccessed;
    vi.advanceTimersByTime(100);

    tracker.add('test-1', handle);
    expect(tracker.get('test-1')).toBe(handle);
    expect(handle.lastAccessed).toBeGreaterThan(beforeTouch);

    tracker.stop();
  });

  it('should sweep out expired tasks and abort them', () => {
    // 10ms TTL for quick test
    const tracker = new RpcActiveTaskTracker(10);
    const mockPromise = new Promise(() => { }); // never resolves
    const aborter = new AbortController();
    let cleanupCalled = false;
    const handle = new RpcActiveTaskHandle('test-2', mockPromise, aborter, false, () => {
      cleanupCalled = true;
    });

    tracker.add('test-2', handle);
    expect(tracker.get('test-2')).toBe(handle);

    // Advance 61 seconds to trigger sweepInterval (which is set to 60000ms usually, but we fake it)
    vi.advanceTimersByTime(65000);

    expect(tracker.get('test-2')).toBeUndefined();
    expect(handle.status).toBe('aborted');
    expect(cleanupCalled).toBe(true);
    expect(aborter.signal.aborted).toBe(true);

    tracker.stop();
  });

  it('should stop tracking and abort all tasks when stop is called', () => {
    const tracker = new RpcActiveTaskTracker();
    const aborter = new AbortController();
    const handle = new RpcActiveTaskHandle('test-3', new Promise(() => { }), aborter, false, () => { });

    tracker.add('test-3', handle);
    tracker.stop();

    expect(tracker.get('test-3')).toBeUndefined();
    expect(handle.status).toBe('aborted');
  });
});

describe('RpcActiveTaskHandle Retention Logic', () => {
  const aborter = new AbortController();
  const mockPromise = Promise.resolve('ok');

  it('should cleanup immediately when mode is None', async () => {
    const handle = new RpcActiveTaskHandle('id', mockPromise, aborter, false, () => { }, { mode: RpcTaskRetentionMode.None });
    await mockPromise;
    expect(handle.shouldCleanup(Date.now())).toBe(true);
  });

  it('should NOT cleanup in Permanent mode unless maxRetentionMs is hit', async () => {
    const handle = new RpcActiveTaskHandle('id', mockPromise, aborter, false, () => { }, { mode: RpcTaskRetentionMode.Permanent });
    await mockPromise;
    expect(handle.shouldCleanup(Date.now())).toBe(false);

    // Now test maxRetentionMs override
    handle.retention.maxRetentionMs = 1000;
    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);
    expect(handle.shouldCleanup(Date.now())).toBe(true);
    vi.useRealTimers();
  });

  it('should handle "once" mode correctly', async () => {
    const handle = new RpcActiveTaskHandle('id', mockPromise, aborter, false, () => { }, 'once');
    await mockPromise;

    // 1. Initial state: not fetched, not timed out
    expect(handle.shouldCleanup(Date.now())).toBe(false);

    // 2. After one fetch: should cleanup
    handle.fetchCount = 1;
    expect(handle.shouldCleanup(Date.now())).toBe(true);

    // 3. Reset and test fallback timeout
    handle.fetchCount = 0;
    vi.useFakeTimers();
    vi.advanceTimersByTime(3600001); // 1 hour + 1s
    expect(handle.shouldCleanup(Date.now())).toBe(true);
    vi.useRealTimers();
  });

  it('should handle millisecond retention correctly', async () => {
    const handle = new RpcActiveTaskHandle('id', mockPromise, aborter, false, () => { }, 5000); // 5 seconds
    await mockPromise;

    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);
    expect(handle.shouldCleanup(Date.now())).toBe(false);

    vi.advanceTimersByTime(4000);
    expect(handle.shouldCleanup(Date.now())).toBe(true);
    vi.useRealTimers();
  });
});
