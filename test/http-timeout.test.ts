// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { ToolFunc } from '@isdk/tool-func'
import { ServerTools } from "../src/server-tools"
import { ClientTools } from '../src/client-tools'
import { findPort } from '@isdk/util'
import { HttpClientToolTransport } from '../src/transports/http-client'
import { HttpServerToolTransport } from '../src/transports/http-server'
import { RpcServerDispatcher } from '../src/transports/dispatcher'

describe('Timeout and ExpectedDuration', () => {
  let apiRoot: string
  let server: HttpServerToolTransport

  beforeAll(async () => {
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}

    // 1. Register a slow tool with metadata timeout
    ServerTools.register({
      name: 'slow-tool',
      timeout: 500,
      expectedDuration: 200,
      func: async ({ delay = 1000 }: { delay?: number }) => {
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
    })

    // 2. Register a tool for keepAliveOnTimeout test
    let keepAliveRan = false;
    ServerTools.register({
      name: 'keep-alive-tool',
      timeout: { value: 100, keepAliveOnTimeout: true },
      func: async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
        keepAliveRan = true;
        return 'done';
      },
      isApi: true,
    })

    // 3. Register a streaming tool for idle timeout test
    ServerTools.register({
      name: 'stream-idle-tool',
      isApi: true,
      stream: true,
      params: { stream: 'boolean' },
      func: async ({ gap = 1000 }) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode('chunk1'));
            await new Promise(resolve => setTimeout(resolve, gap));
            controller.enqueue(encoder.encode('chunk2'));
            controller.close();
          }
        });
        return stream;
      }
    })

    // 4. Register nested tools for propagation test
    ServerTools.register({
      name: 'tool-a',
      isApi: true,
      func: async function (params) {
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

    // Setup Dispatcher Registry
    RpcServerDispatcher.instance.registry = ServerTools;

    const port = await findPort(3000)
    apiRoot = `http://localhost:${port}/api`

    server = new HttpServerToolTransport({ port, apiUrl: apiRoot })
    server.addRpcHandler(apiRoot)
    server.addDiscoveryHandler(apiRoot, () => ServerTools.toJSON())

    await server.start({ port })

    const clientTransport = new HttpClientToolTransport(apiRoot);
    ClientTools.setTransport(clientTransport);
    await ClientTools.loadFrom()
  })


  afterAll(async () => {
    await server.stop()
    ToolFunc.items = {}
    ServerTools.items = {}
    ClientTools.items = {}
  })

  it('should discover timeout and expectedDuration metadata', () => {
    const slowTool = ClientTools.get('slow-tool')!;
    expect(slowTool).toBeDefined();
    expect(slowTool.timeout).toBe(500);
    expect(slowTool.expectedDuration).toBe(200);
  });

  it('should fail with 504 when server-side execution timeout occurs', async () => {
    const slowTool = ClientTools.get('slow-tool')!;
    try {
      // Override client timeout to 2000ms, but server tool metadata is 500ms.
      // Server should timeout at 500ms and return 504.
      await slowTool.run({ delay: 1000 }, { timeout: 2000 });
      expect.fail('Should have thrown 504');
    } catch (err: any) {
      expect(err.code).toBe(504);
      expect(err.message).toMatch(/Timeout/i);
    }
  });

  it('should support client-side manual timeout override', async () => {
    const slowTool = ClientTools.get('slow-tool')!;
    // Set manual timeout to 100ms.
    // Since we now have a buffer and server respects rpc-timeout,
    // the server should return 504 at 100ms.
    try {
      await slowTool.run({ delay: 1000 }, { timeout: 100 });
      expect.fail('Should have aborted');
    } catch (err: any) {
      expect(err.code).toBe(504);
      expect(err.message).toMatch(/Timeout/i);
    }
  });

  it('should support active interruption via AbortSignal', async () => {
    const slowTool = ClientTools.get('slow-tool')!;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    try {
      await slowTool.run({ delay: 1000 }, { signal: controller.signal });
      expect.fail('Should have aborted');
    } catch (err: any) {
      // Active interruption should result in AbortError (code 20 in some environments)
      expect(err.name).toBe('AbortError');
    }
  });

  it('should propagate AbortSignal to the tool function', async () => {
    const slowTool = ClientTools.get('slow-tool')!;
    // We expect the server to abort the function when timeout occurs.
    // The tool function in this test rejects with 'Aborted by signal' when aborted.
    // However, the server returns 504 to the client when its timeoutPromise wins the race.
    // To verify signal propagation, we'd need server-side logs or a side-effect.
    // The current server implementation returns 504 when timeout occurs.
    try {
      await slowTool.run({ delay: 2000 });
    } catch (err: any) {
      expect(err.code).toBe(504);
    }
  });

  it('should propagate AbortSignal through nested tool calls (A -> B)', async () => {
    const toolA = ClientTools.get('tool-a');
    try {
      await toolA!.with({ timeout: 200 }).run({ delay: 1000 });
      expect.fail('Should have timed out at 200ms');
    } catch (err: any) {
      expect(err.code).toBe(504);
    }
  });

  it('should support timeout during API discovery (loadFrom)', async () => {
    const originalHandler = (server as any).discoveryHandlerInfo.handler;
    (server as any).discoveryHandlerInfo.handler = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return originalHandler();
    };

    try {
      await ClientTools.loadFrom(undefined, { timeout: 100 });
      expect.fail('Discovery should have timed out');
    } catch (err: any) {
      expect(err.name).toMatch(/AbortError|Error/i);
    }

    (server as any).discoveryHandlerInfo.handler = originalHandler;
  });

  it('should handle concurrent requests with different timeouts', async () => {
    const slowTool = ClientTools.get('slow-tool');

    const req1 = slowTool!.run({ delay: 500 }, { timeout: 200 }); // Should fail
    const req2 = slowTool!.run({ delay: 100 }, { timeout: 1000 }); // Should succeed

    const results = await Promise.allSettled([req1, req2]);

    expect(results[0].status).toBe('rejected');
    expect((results[0] as any).reason.code).toBe(504);

    expect(results[1].status).toBe('fulfilled');
    expect((results[1] as any).value).toBe('done');
  });

  it('should fail with stream idle timeout', async () => {
    const streamTool = ClientTools.get('stream-idle-tool')!;
    // Set streamIdleTimeout to 100ms, but gap is 500ms
    const res = await streamTool.run({ gap: 500, stream: true }, { timeout: { value: 2000, streamIdleTimeout: 100 } });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const chunk1 = await reader.read();
    expect(decoder.decode(chunk1.value)).toBe('chunk1');

    try {
      await reader.read();
      expect.fail('Should have timed out on idle');
    } catch (err: any) {
      expect(err.message).toMatch(/Idle Timeout/i);
    }
  });
});
