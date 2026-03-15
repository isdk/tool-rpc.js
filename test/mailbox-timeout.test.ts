// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox';
import { ToolFunc } from '@isdk/tool-func';
import { ServerTools } from '../src/server-tools';
import { ClientTools } from '../src/client-tools';
import { MailboxServerTransport } from '../src/transports/mailbox/server';
import { MailboxClientTransport } from '../src/transports/mailbox/client';
// Use a global object to track status to avoid closure issues
const MailboxTestStatus = {
  jobFinished: false,
  jobStarted: false,
};

describe('Mailbox Timeout and ExpectedDuration', () => {
  // ...

  let mailbox: Mailbox;
  let serverTransport: MailboxServerTransport;
  let clientTransport: MailboxClientTransport;

  const serverAddress = 'mem://api@server/api';
  const clientAddress = 'mem://user@client/inbox';

  beforeAll(async () => {
    // Reset registries
    ToolFunc.items = {};
    ServerTools.items = {};
    ClientTools.items = {};

    mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());

    // 1. Register a slow tool with metadata timeout
    ServerTools.register({
      name: 'slow-mailbox-tool',
      timeout: 500,
      expectedDuration: 200,
      func: async ({ delay = 1000 }) => {
        const signal = (this as any).ctx?.signal;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('done'), delay);
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('Aborted by signal'));
            });
          }
        });
      },
      isApi: true,
    });

    // 4. Register nested tools for propagation test
    ServerTools.register({
      name: 'tool-a',
      isApi: true,
      func: async function (params) {
        // Call tool-b and pass along the context (implicitly via tool-func's runAs)
        return await (this as any).runAs('tool-b', params);
      }
    });

    ServerTools.register({
      name: 'tool-b',
      isApi: true,
      func: async function ({ delay = 1000 }) {
        const signal = (this as any).ctx?.signal;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('b-done'), delay);
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('B aborted'));
            });
          }
        });
      }
    });

    // 2. Setup server transport
    serverTransport = new MailboxServerTransport({ mailbox, address: serverAddress });
    serverTransport.mount(ServerTools);
    await serverTransport.start();

    // 3. Setup client transport
    clientTransport = new MailboxClientTransport({
      mailbox,
      serverAddress: serverAddress,
      clientAddress: clientAddress,
      timeout: 2000, // Global transport default
    });

    await clientTransport.mount(ClientTools);
    await ClientTools.loadFrom();
  });

  afterAll(async () => {
    await serverTransport.stop();
    await clientTransport.stop();
    ToolFunc.items = {};
    ServerTools.items = {};
    ClientTools.items = {};
  });

  it('should discover timeout and expectedDuration metadata over mailbox', () => {
    const slowTool = ClientTools.get('slow-mailbox-tool');
    expect(slowTool).toBeDefined();
    expect(slowTool!.timeout).toBe(500);
    expect(slowTool!.expectedDuration).toBe(200);
  });

  it('should fail with 504 when mailbox server-side execution timeout occurs', async () => {
    const slowTool = ClientTools.get('slow-mailbox-tool');
    try {
      // Use tool's metadata timeout (500ms)
      await slowTool!.run({ delay: 1000 });
      expect.fail('Should have thrown 504');
    } catch (err: any) {
      expect(err.code).toBe(504);
      expect(err.message).toMatch(/Timeout/i);
    }
  });

  it('should support context-driven timeout via .with({ timeout })', async () => {
    const slowTool = ClientTools.get('slow-mailbox-tool');
    // Override with a very short timeout
    const timedTool = slowTool!.with({ timeout: 100 });

    try {
      await timedTool.run({ delay: 1000 });
      expect.fail('Should have timed out at 100ms');
    } catch (err: any) {
      // Mailbox server will return 504 if it receives rpc-timeout: 100
      expect(err.code).toBe(504);
    }
  });

  it('should support active interruption via AbortSignal over mailbox', async () => {
    const slowTool = ClientTools.get('slow-mailbox-tool');
    const controller = new AbortController();

    // Trigger abort after 100ms
    setTimeout(() => controller.abort(), 100);

    try {
      await slowTool!.run({ delay: 1000 }, { signal: controller.signal });
      expect.fail('Should have aborted');
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
    }
  });

  it('should send timeout and expectedDuration in mailbox headers', async () => {
    const postSpy = vi.spyOn(mailbox, 'post');
    const slowTool = ClientTools.get('slow-mailbox-tool');

    try {
      // Manual timeout is 800, but tool metadata is 500.
      // Negotiated timeout should be min(500, 800) = 500.
      await slowTool!.run({ delay: 50 }, { timeout: 800, expectedDuration: 300 });
    } catch (e) { }

    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        'rpc-timeout': '500',
        'rpc-expected-duration': '300'
      })
    }));
    postSpy.mockRestore();
  });
  it('should handle concurrent requests with different timeouts', async () => {
    const slowTool = ClientTools.get('slow-mailbox-tool');

    const req1 = slowTool!.run({ delay: 500 }, { timeout: 200 }); // Should fail (500 > 200)
    const req2 = slowTool!.run({ delay: 100 }, { timeout: 1000 }); // Should succeed (100 < 1000)

    const results = await Promise.allSettled([req1, req2]);

    expect(results[0].status).toBe('rejected');
    expect((results[0] as any).reason.code).toBe(504);

    expect(results[1].status).toBe('fulfilled');
    expect((results[1] as any).value).toBe('done');
  });

  it('should propagate AbortSignal through nested tool calls (A -> B)', async () => {
    const toolA = ClientTools.get('tool-a');
    // Set a timeout that will trigger while tool-b is running
    try {
      await toolA!.with({ timeout: 200 }).run({ delay: 1000 });
      expect.fail('Should have timed out at 200ms');
    } catch (err: any) {
      expect(err.code).toBe(504);
      // Even though tool-b returns "B aborted", the transport will wrap it
      // as 504 because the server-side timeoutPromise wins.
    }
  });

  it('should support timeout during API discovery (loadFrom)', async () => {
    // Simulate a slow discovery by temporarily replacing the handler
    const originalHandler = (serverTransport as any).discoveryHandlerInfo.handler;
    (serverTransport as any).discoveryHandlerInfo.handler = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return originalHandler();
    };

    // Attempt to load APIs with a shorter timeout
    try {
      await ClientTools.loadFrom(undefined, { timeout: 100 });
      expect.fail('Discovery should have timed out');
    } catch (err: any) {
      // In MailboxClientTransport, loadApis uses fetch, which now respects timeout
      expect(err.message).toMatch(/timeout/i);
    }

    // Restore original handler for subsequent tests
    (serverTransport as any).discoveryHandlerInfo.handler = originalHandler;
  });

  it('should respect keepAliveOnTimeout over mailbox', async () => {
    (globalThis as any).MailboxTestStatus = {
      jobFinished: false,
      jobStarted: false,
    };

    ServerTools.register({
      name: 'keep-alive-mailbox-tool',
      timeout: { value: 100, keepAliveOnTimeout: true },
      func: async function () {
        const status = (globalThis as any).MailboxTestStatus;
        status.jobStarted = true;
        const ctx = (this as any).ctx;
        console.log(`[TestTool] Background job started. ctx.signal.aborted: ${ctx?.signal?.aborted}`);

        await new Promise(resolve => setTimeout(resolve, 300));

        status.jobFinished = true;
        console.log(`[TestTool] Background job finished! ctx.signal.aborted: ${ctx?.signal?.aborted}`);
        return 'done';
      },
      isApi: true,
    });

    await ClientTools.loadFrom();
    const tool = ClientTools.get('keep-alive-mailbox-tool');
    console.log('[Test] Triggering keep-alive-mailbox-tool...');

    try {
      await tool!.run({});
      expect.fail('Should have timed out');
    } catch (err: any) {
      console.log(`[Test] Received expected error: ${err.message} (code: ${err.code})`);
      expect(err.code).toBe(504);
    }

    const status = (globalThis as any).MailboxTestStatus;
    expect(status.jobStarted).toBe(true);
    // Wait longer to ensure background job finishes even in slow environments
    console.log('[Test] Waiting for background job completion...');
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log(`[Test] Final state - jobFinished: ${status.jobFinished}`);
    expect(status.jobFinished).toBe(true);
  });


});
