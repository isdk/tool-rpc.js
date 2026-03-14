import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcActiveTaskTracker, ActiveTaskHandle } from './task-tracker';

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
    const handle = new ActiveTaskHandle('test-1', mockPromise, aborter, false, () => {});

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
    const mockPromise = new Promise(() => {}); // never resolves
    const aborter = new AbortController();
    let cleanupCalled = false;
    const handle = new ActiveTaskHandle('test-2', mockPromise, aborter, false, () => {
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
    const handle = new ActiveTaskHandle('test-3', new Promise(() => {}), aborter, false, () => {});
    
    tracker.add('test-3', handle);
    tracker.stop();

    expect(tracker.get('test-3')).toBeUndefined();
    expect(handle.status).toBe('aborted');
  });
});

describe('ActiveTaskHandle', () => {
  it('should mark status completed when promise resolves', async () => {
    const aborter = new AbortController();
    const handle = new ActiveTaskHandle('id1', Promise.resolve('ok'), aborter, false, () => {});
    await handle.promise;
    expect(handle.status).toBe('completed');
    expect(handle.result).toBe('ok');
  });

  it('should mark status error when promise rejects naturally', async () => {
    const aborter = new AbortController();
    const p = Promise.reject(new Error('fail'));
    const handle = new ActiveTaskHandle('id2', p, aborter, false, () => {});
    try { await p; } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(handle.status).toBe('error');
    expect(handle.error.message).toBe('fail');
  });

  it('should mark status aborted if controller aborts', () => {
    const aborter = new AbortController();
    let cleanupCalled = false;
    const handle = new ActiveTaskHandle('id3', new Promise(() => {}), aborter, false, () => {
       cleanupCalled = true;
    });
    
    handle.abort('reason');
    expect(handle.status).toBe('aborted');
    expect(aborter.signal.aborted).toBe(true);
    expect(aborter.signal.reason).toBe('reason');
    expect(cleanupCalled).toBe(true);
  });
});
