import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcActiveTaskTracker, RpcActiveTaskHandle } from './task-tracker';
import { RpcTaskRetentionMode } from './models';

describe('Transport V2: Result Retention Policy', () => {
   let tracker: RpcActiveTaskTracker;

   beforeEach(() => {
      // 在创建 tracker 之前启用模拟计时器，确保 Date.now() 步调一致
      vi.useFakeTimers();
      tracker = new RpcActiveTaskTracker(500); 
   });

   afterEach(() => {
      tracker.stop();
      vi.useRealTimers();
   });

   it('should respect "None" (0) mode: cleanup immediately after completion', async () => {
      const promise = Promise.resolve('ok');
      const aborter = new AbortController();
      const handle = new RpcActiveTaskHandle(
         'req-none', promise, aborter, false, () => {}, 
         RpcTaskRetentionMode.None
      );

      tracker.add('req-none', handle);
      await promise;

      expect(handle.shouldCleanup(Date.now())).toBe(true);
   });

   it('should respect "Once" mode: cleanup after first successful fetch', async () => {
      const promise = Promise.resolve('ok');
      const aborter = new AbortController();
      const handle = new RpcActiveTaskHandle(
         'req-once', promise, aborter, false, () => {}, 
         RpcTaskRetentionMode.Once
      );

      tracker.add('req-once', handle);
      await promise;

      expect(handle.shouldCleanup(Date.now())).toBe(false);

      handle.fetchCount++;
      expect(handle.shouldCleanup(Date.now())).toBe(true);
   });

   it('should respect "Permanent" (-1) mode: never cleanup automatically', async () => {
      const promise = Promise.resolve('ok');
      const aborter = new AbortController();
      const handle = new RpcActiveTaskHandle(
         'req-perm', promise, aborter, false, () => {}, 
         RpcTaskRetentionMode.Permanent
      );

      tracker.add('req-perm', handle);
      await promise;
      handle.fetchCount = 100;

      expect(handle.shouldCleanup(Date.now())).toBe(false);
   });

   it('should respect "number" mode: cleanup after specified milliseconds', async () => {
      const promise = Promise.resolve('ok');
      const aborter = new AbortController();
      const retentionMs = 1000;
      const handle = new RpcActiveTaskHandle(
         'req-timed', promise, aborter, false, () => {}, 
         retentionMs
      );

      tracker.add('req-timed', handle);
      await promise;

      expect(handle.shouldCleanup(Date.now())).toBe(false);

      vi.advanceTimersByTime(500);
      expect(handle.shouldCleanup(Date.now())).toBe(false);

      vi.advanceTimersByTime(600);
      expect(handle.shouldCleanup(Date.now())).toBe(true);
   });

   it('should abort and cleanup tasks when client heartbeat (TTL) expires', async () => {
      const promise = new Promise(() => {}); // 永不完成
      const aborter = new AbortController();
      let cleanupCalled = false;
      const handle = new RpcActiveTaskHandle(
         'req-ttl', promise, aborter, false, () => { cleanupCalled = true; }, 
         RpcTaskRetentionMode.Permanent
      );

      tracker.add('req-ttl', handle);

      // 前进 600ms，超过 TTL (500ms)
      vi.advanceTimersByTime(600);
      
      // 前进 60秒触发 Tracker 的扫除定时器
      await vi.advanceTimersByTimeAsync(60000);

      expect(handle.status).toBe('aborted');
      expect(tracker.get('req-ttl')).toBeUndefined();
      expect(cleanupCalled).toBe(true);
   });
});
