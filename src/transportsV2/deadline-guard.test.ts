import { describe, it, expect, vi } from 'vitest';
import { RpcDeadlineGuard } from './deadline-guard';

describe('RpcDeadlineGuard', () => {
   it('should timeout and reject with 102 Error when reach limit', async () => {
      vi.useFakeTimers();
      let timeoutFired = false;
      const guard = new RpcDeadlineGuard(100, {
         onResponseTimeout: () => { timeoutFired = true; }
      });

      const promise = guard.getPromise();

      // Advance timers to trigger timeout
      vi.advanceTimersByTime(110);

      try {
         await promise;
         expect.fail('Should have thrown timeout 102');
      } catch (err: any) {
         expect(err.code).toBe(102);
         expect(err.message).toBe('Processing / Keep-Alive');
      }

      expect(timeoutFired).toBe(true);
      guard.cancel(); // clean up
      vi.useRealTimers();
   });

   it('should not fire if cancelled before timeout', async () => {
      vi.useFakeTimers();
      let timeoutFired = false;
      const guard = new RpcDeadlineGuard(100, {
         onResponseTimeout: () => { timeoutFired = true; }
      });

      const promise = guard.getPromise();

      // Cancel before timeout
      vi.advanceTimersByTime(50);
      guard.cancel();
      vi.advanceTimersByTime(100);

      // It should never reject/resolve once cancelled and swept
      // Wait slightly to ensure it didn't fire
      await Promise.resolve();

      expect(timeoutFired).toBe(false);
      vi.useRealTimers();
   });
});
