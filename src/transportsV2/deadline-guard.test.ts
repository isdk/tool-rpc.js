import { describe, it, expect, vi } from 'vitest';
import { RpcDeadlineGuard } from './deadline-guard';
import { RpcStatusCode } from './models';

describe('RpcDeadlineGuard', () => {
   it('should timeout and reject with 102 Error when reach soft limit', async () => {
      vi.useFakeTimers();
      let timeoutFired = false;
      const guard = new RpcDeadlineGuard(100, {
         onResponseTimeout: () => { timeoutFired = true; }
      });

      const promise = guard.start();

      // Advance timers to trigger timeout
      vi.advanceTimersByTime(110);

      try {
         await promise;
         expect.fail('Should have thrown timeout 102');
      } catch (err: any) {
         expect(err.code).toBe(RpcStatusCode.PROCESSING);
         expect(err.message).toMatch(/Response Timeout/);
      }

      expect(timeoutFired).toBe(true);
      guard.cancel(); // clean up
      vi.useRealTimers();
   });

   it('should trigger hard deadline with grace period', async () => {
      vi.useFakeTimers();
      let hardDeadlineFired = false;
      let hookReason: any = null;
      
      const graceMs = 500;
      const guard = new RpcDeadlineGuard(
         100, // soft
         {
            onHardDeadline: (reason) => { 
               hardDeadlineFired = true; 
               hookReason = reason;
            }
         },
         200, // hard
         graceMs
      );

      const promise = guard.start();

      // 1. Advance to soft timeout
      vi.advanceTimersByTime(110);
      try { await promise; } catch (e) {} // Consume soft timeout
      
      // Re-start or use the same promise logic? 
      // In RpcDeadlineGuard, once rejected it's done. 
      // Let's test only hard deadline for clarity.
      guard.cancel();
      
      const hardOnlyGuard = new RpcDeadlineGuard(
         0, 
         { onHardDeadline: () => { hardDeadlineFired = true; } },
         200,
         graceMs
      );
      const hardPromise = hardOnlyGuard.start();

      // 2. Advance to just before hard timeout
      vi.advanceTimersByTime(190);
      expect(hardDeadlineFired).toBe(false);

      // 3. Advance to hard timeout
      vi.advanceTimersByTime(20);
      expect(hardDeadlineFired).toBe(true);
      
      // 4. At this moment, the promise should NOT have rejected yet because of grace period
      let resolved = false;
      hardPromise.catch(() => { resolved = true; });
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(false);

      // 5. Advance past grace period
      vi.advanceTimersByTime(graceMs + 10);
      await Promise.resolve();
      
      try {
         await hardPromise;
         expect.fail('Should have thrown 408');
      } catch (err: any) {
         expect(err.code).toBe(RpcStatusCode.TERMINATED);
      }

      hardOnlyGuard.cancel();
      vi.useRealTimers();
   });

   it('should not fire if cancelled before timeout', async () => {
      vi.useFakeTimers();
      let timeoutFired = false;
      const guard = new RpcDeadlineGuard(100, {
         onResponseTimeout: () => { timeoutFired = true; }
      });

      const promise = guard.start();

      // Cancel before timeout
      vi.advanceTimersByTime(50);
      guard.cancel();
      vi.advanceTimersByTime(100);

      // We need to check if the promise ever settles. 
      // In our implementation, if cancelled, the rejector is cleared, 
      // so the promise will hang forever (which is fine for a cancelled guard).
      let settled = false;
      promise.finally(() => { settled = true; });
      
      await Promise.resolve();
      expect(timeoutFired).toBe(false);
      expect(settled).toBe(false);
      
      vi.useRealTimers();
   });
});
