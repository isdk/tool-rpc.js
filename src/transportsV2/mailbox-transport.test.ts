import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Mailbox, MemoryProvider, MailMessage } from '@mboxlabs/mailbox';

import { ToolFunc, Funcs } from '@isdk/tool-func';
import { ServerFuncItem, ServerTools } from '../server-tools';
import { ResServerTools } from '../res-server-tools';
import { ClientTools } from '../client-tools';
import { ResClientTools } from '../res-client-tools';
import { ToolRpcRequest, ToolRpcResponse, ToolRpcContext, RPC_HEADERS } from './models';
import { MailboxServerTransport as V2MailboxServerTransport } from './mailbox-server';
import { MailboxClientTransport as V2MailboxClientTransport } from './mailbox-client';

describe('MailboxServerTransport / MailboxClientTransport V2 Test', () => {
  let mailbox: Mailbox;
  let serverTransport: V2MailboxServerTransport;
  let resServerTransport: V2MailboxServerTransport;
  let clientTransport: V2MailboxClientTransport;
  let resClientTransport: V2MailboxClientTransport;

  const serverAddress = 'mem://api@server/api';
  const resServerAddress = 'mem://api@server/res';
  const clientAddress = 'mem://user@client/inbox';
  const resClientAddress = 'mem://user@client/res-inbox';

  beforeAll(async () => {
    // 1. Isolate Server side items
    const serverItems: any = Object.create(ToolFunc.items);
    (ServerTools as any).items = serverItems;
    (ResServerTools as any).items = serverItems;

    // 2. Isolate Client side items
    const clientItems: Funcs = {};
    (ClientTools as any).items = clientItems;
    (ResClientTools as any).items = clientItems;

    mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());

    // 3. Register tools
    new ServerTools({
      name: 'calculator',
      isApi: true,
      func: ({ a, b }: { a: number; b: number }) => a + b,
    }).register();

    new ServerTools({
      name: 'errorTool',
      isApi: true,
      func: () => {
        const err: any = new Error('server-side error');
        err.code = 418;
        err.data = { hint: 'I am a teapot' };
        throw err;
      },
    }).register();

    // 4. Setup server transports
    serverTransport = new V2MailboxServerTransport({ mailbox, apiUrl: serverAddress });
    serverTransport.dispatcher.registry = ServerTools;
    serverTransport.addDiscoveryHandler(serverAddress, () => ServerTools);
    serverTransport.addRpcHandler(serverAddress);
    await serverTransport.start();

    resServerTransport = new V2MailboxServerTransport({ mailbox, apiUrl: resServerAddress });
    resServerTransport.dispatcher.registry = ResServerTools;
    resServerTransport.addDiscoveryHandler(resServerAddress, () => ResServerTools);
    resServerTransport.addRpcHandler(resServerAddress);
    await resServerTransport.start();

    // 5. Setup client transports
    clientTransport = new V2MailboxClientTransport({
      mailbox,
      serverAddress: serverAddress,
      clientAddress: clientAddress,
      timeout: 1000,
    });
    ClientTools.setTransport(clientTransport);
    await clientTransport.start();

    resClientTransport = new V2MailboxClientTransport({
      mailbox,
      serverAddress: resServerAddress,
      clientAddress: resClientAddress,
      timeout: 2000,
    });
    ResClientTools.setTransport(resClientTransport);
    await resClientTransport.start();
  });

  afterAll(async () => {
    await serverTransport.stop();
    await resServerTransport.stop();
    await clientTransport.stop();
    await resClientTransport.stop();
    delete (ServerTools as any).items;
    delete (ResServerTools as any).items;
    delete (ClientTools as any).items;
    delete (ResClientTools as any).items;
  });

  it('should load APIs via discovery', async () => {
    await ClientTools.loadFrom();
    expect(ClientTools.get('calculator')).toBeDefined();
    expect(ClientTools.get('errorTool')).toBeDefined();
  });

  it('should call remote tool and get result', async () => {
    const calculator = ClientTools.get('calculator');
    const result = await calculator!.run({ a: 10, b: 32 });
    expect(result).toBe(42);
  });

  it('should handle remote structured errors', async () => {
    const errorTool = ClientTools.get('errorTool');
    try {
      await errorTool!.run({});
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toBe('server-side error');
      expect(error.code).toBe(418);
      expect(error.data).toEqual({ hint: 'I am a teapot' });
    }
  });

  it('should allow tool to access sender information via V2 context headers', async () => {
    new ServerTools({
      name: 'whoami',
      isApi: true,
      func: (params: any, context: any) => {
        // V2 Native way: use headers
        return { sender: context.headers['x-mailbox-from'] };
      },
    }).register();

    await ClientTools.loadFrom();
    const whoamiTool = ClientTools.get('whoami');
    const result = await whoamiTool!.run({});

    expect(result.sender).toBe(clientAddress);
  });

  it('should support discovery via "list" action using headers', async () => {
    const items = await clientTransport.fetch('', {}, 'list');
    expect(items).toHaveProperty('calculator');
    expect(items).toHaveProperty('whoami');
  });

  it('should support RESTful style call with resId via Headers', async () => {
    class UserResTool extends ResServerTools {
      get(params: any, context: ToolRpcContext) {
        return { resId: context.resId, name: 'Alice' };
      }
    }
    (new UserResTool('users') as any).register('users', { isApi: true });

    await ResClientTools.loadFrom();
    const userTool = ResClientTools.get('users');
    if (userTool) {
      const user = await userTool.fetch({ id: '123' }, 'get');
      expect(user).toEqual({ resId: '123', name: 'Alice' });
    } else {
      expect.fail('UserResTool should be discovered');
    }
  });

  it('should work in Pull mode', async () => {
    const pullServerAddress = 'mem://pull-server/api';
    const pullServer = new V2MailboxServerTransport({
      mailbox,
      apiUrl: pullServerAddress,
      mode: 'pull',
      pullInterval: 10
    });

    new ServerTools({
      name: 'pullTester',
      isApi: true,
      func: () => 'pull-success',
    }).register();

    pullServer.dispatcher.registry = ServerTools;
    pullServer.addDiscoveryHandler(pullServerAddress, () => ServerTools);
    pullServer.addRpcHandler(pullServerAddress);
    await pullServer.start();

    const pullClient = new V2MailboxClientTransport({
      mailbox,
      serverAddress: pullServerAddress,
      clientAddress: 'mem://pull-client/inbox',
      timeout: 2000,
    });

    const pullClientItems = {};
    const pullClientToolsClass = class extends ClientTools { static items = pullClientItems } as any;
    pullClientToolsClass.setTransport(pullClient);
    await pullClient.start();

    const result = await pullClient.fetch('pullTester');
    expect(result).toBe('pull-success');

    await pullServer.stop();
    await pullClient.stop();
  });

  it('should redirect response to mbx-reply-to address', async () => {
    const thirdPartyAddress = 'mem://third-party/inbox';
    const onReceive = vi.fn();
    mailbox.subscribe(thirdPartyAddress, (msg) => onReceive(msg.body));

    await mailbox.post({
      from: clientAddress,
      to: serverAddress,
      body: { a: 10, b: 20 },
      headers: {
        'mbx-fn-id': 'calculator',
        'mbx-act': 'post',
        'mbx-reply-to': thirdPartyAddress,
        'req-id': 'redirect-test'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onReceive).toHaveBeenCalledWith(30);
  });

  it('should handle backlog in Pull mode', async () => {
    const backlogAddress = 'mem://backlog-server/api';
    const msgCount = 3;

    for (let i = 0; i < msgCount; i++) {
      await mailbox.post({
        from: clientAddress,
        to: backlogAddress,
        body: { val: i },
        headers: { 'mbx-fn-id': 'backlog-adder', 'req-id': `backlog-${i}`, 'mbx-act': 'post' }
      });
    }

    (globalThis as any).backlogProcessedCount = 0;
    new ServerTools({
      name: 'backlog-adder',
      isApi: true,
      func: () => {
        (globalThis as any).backlogProcessedCount++;
        return 'ok';
      },
    }).register();

    const pullServer = new V2MailboxServerTransport({
      mailbox,
      apiUrl: backlogAddress,
      mode: 'pull',
      pullInterval: 5
    });
    pullServer.dispatcher.registry = ServerTools;
    pullServer.addDiscoveryHandler(backlogAddress, () => ServerTools);
    pullServer.addRpcHandler(backlogAddress);
    await pullServer.start();

    await new Promise(resolve => setTimeout(resolve, 200));
    expect((globalThis as any).backlogProcessedCount).toBe(msgCount);

    delete (globalThis as any).backlogProcessedCount;
    await pullServer.stop();
  });

  it('should work with empty body', async () => {
    new ServerTools({
      name: 'ping',
      isApi: true,
      func: () => 'pong',
    }).register();

    await ClientTools.loadFrom();
    const result = await clientTransport.fetch('ping', undefined);
    expect(result).toBe('pong');
  });

  it('should preserve custom mbx- headers through transport', async () => {
    new ServerTools({
      name: 'headerInspector',
      isApi: true,
      func: (params: any, context: any) => {
        return {
          custom: context.headers?.['mbx-custom-field'],
          traceId: context.headers?.['rpc-trace-id'] || context.headers?.['mbx-trace-id'],
        };
      },
    }).register();

    await ClientTools.loadFrom();
    const result = await clientTransport.fetch('headerInspector', {}, 'post', undefined, {
      headers: {
        'mbx-custom-field': 'hello-world',
        'rpc-trace-id': 'trace-123'
      }
    });

    expect(result.custom).toBe('hello-world');
    expect(result.traceId).toBe('trace-123');
  });

  it('should handle concurrent requests to different tools', async () => {
    new ServerTools({
      name: 'toolA',
      isApi: true,
      func: async () => {
        await new Promise(r => setTimeout(r, 20));
        return 'resA';
      },
    }).register();

    new ServerTools({
      name: 'toolB',
      isApi: true,
      func: () => 'resB',
    }).register();

    await ClientTools.loadFrom();

    const [resA, resB] = await Promise.all([
      clientTransport.fetch('toolA'),
      clientTransport.fetch('toolB')
    ]);

    expect(resA).toBe('resA');
    expect(resB).toBe('resB');
  });

  it('should handle void or null results correctly', async () => {
    new ServerTools({
      name: 'voidTool',
      isApi: true,
      func: () => { /* returns undefined */ },
    }).register();

    new ServerTools({
      name: 'nullTool',
      isApi: true,
      func: () => null,
    }).register();

    await ClientTools.loadFrom();

    const resVoid = await clientTransport.fetch('voidTool');
    expect(resVoid).toBeUndefined();

    const resNull = await clientTransport.fetch('nullTool');
    expect(resNull).toBeNull();
  });

  it('should reject requests without mbx-fn-id header', async () => {
    const responsePromise = new Promise<any>((resolve) => {
      const sub = mailbox.subscribe(clientAddress, (msg) => {
        if (msg.headers?.['req-id'] === 'no-fn-id') {
          sub.unsubscribe();
          resolve(msg.body);
        }
      });
    });

    await mailbox.post({
      from: clientAddress,
      to: serverAddress,
      body: { some: 'data' },
      headers: { 'req-id': 'no-fn-id' }
    });

    const response = await responsePromise;
    expect(response.error.message).toContain("missing tool identifier");
    expect(response.error.code).toBe(400);
  });

  it('should support discovery via "get" action', async () => {
    const items = await clientTransport.fetch('', {}, 'get');
    expect(items).toHaveProperty('calculator');
  });

  it('should fallback to "from" address when mbx-reply-to is missing', async () => {
    const onReceive = vi.fn();
    mailbox.subscribe(clientAddress, (msg) => onReceive(msg.body));

    await mailbox.post({
      from: clientAddress,
      to: serverAddress,
      body: { a: 5, b: 5 },
      headers: {
        'mbx-fn-id': 'calculator',
        'mbx-act': 'post',
        'req-id': 'fallback-test'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onReceive).toHaveBeenCalledWith(10);
  });

  it('should handle large payloads correctly', async () => {
    const largeData = 'a'.repeat(1024 * 100); // 100KB string
    new ServerTools({
      name: 'echo',
      isApi: true,
      func: (params: any) => params.data,
    }).register();

    await ClientTools.loadFrom();
    const result = await clientTransport.fetch('echo', { data: largeData });
    expect(result).toBe(largeData);
  });

  it('should be able to restart server transport', async () => {
    await serverTransport.stop();
    await mailbox.post({
      from: clientAddress,
      to: serverAddress,
      body: { a: 1, b: 1 },
      headers: { 'mbx-fn-id': 'calculator', 'mbx-act': 'post', 'req-id': 'restart-test' }
    });

    const responsePromise = new Promise<any>((resolve) => {
      const sub = mailbox.subscribe(clientAddress, (msg) => {
        if (msg.headers?.['req-id'] === 'restart-test') {
          sub.unsubscribe();
          resolve(msg.body);
        }
      });
    });

    await serverTransport.start();

    const response = await responsePromise;
    expect(response).toBe(2);
  });

  it('should reject pending requests when transport is stopped', async () => {
    const stopTransport = new V2MailboxClientTransport({
      mailbox,
      serverAddress: 'mem://nobody-listener/api',
      clientAddress: 'mem://stopper@client/inbox',
      timeout: 5000,
    });
    (stopTransport as any).subscription = mailbox.subscribe(
      (stopTransport as any).clientAddress,
      (stopTransport as any).onResponse.bind(stopTransport)
    );

    const promise = stopTransport.fetch('any-tool');
    await stopTransport.stop();

    await expect(promise).rejects.toThrow('Transport stopped');
  });

  describe('MailboxServerTransport Internal Path Logic', () => {
    it('should extract apiPrefix correctly from complex URLs', () => {
      const transport = new V2MailboxServerTransport({ mailbox, apiUrl: 'mem://my-bot/api/v1?debug=true' });
      expect((transport as any).apiPrefix).toBe('/api/v1/');
    });

    it('should handle URLs with redundant slashes', () => {
      const transport = new V2MailboxServerTransport({ mailbox, apiUrl: 'mem://my-bot///api//v2//' });
      expect((transport as any).apiPrefix).toBe('/api/v2/');
    });

    it('should normalize paths in addRpcHandler', () => {
      const transport = new V2MailboxServerTransport({ mailbox, apiUrl: 'mem://my-bot/' });
      transport.addRpcHandler('mem://my-bot/custom-path');
      expect((transport as any).apiPrefix).toBe('/custom-path/');
    });

    it('should handle malformed URLs gracefully by falling back to root', () => {
      const transport = new V2MailboxServerTransport({ mailbox, apiUrl: 'not-a-valid-url' });
      expect((transport as any).apiPrefix).toBe('/');
    });

    it('should prioritize V2 headers over V1 mbx- headers', async () => {
      // 在这个测试中，我们手动模拟一个混合消息
      const rpcReq = await (serverTransport as any).toRpcRequest({
        id: 'priority-test',
        body: {},
        headers: {
          'req-id': 'pri-test-id',
          'rpc-func': 'v2-tool',
          'mbx-fn-id': 'v1-tool',
          'rpc-act': 'v2-act',
          'mbx-act': 'v1-act'
        }
      });
      expect(rpcReq.toolId).toBe('v2-tool');
      expect(rpcReq.requestId).toBe('pri-test-id');
      expect(rpcReq.act).toBe('v2-act');
    });
  });

  describe('Strict Mode and req-id logic', () => {
    it('should reject request without req-id in default Strict Mode', async () => {
      const responsePromise = new Promise<any>((resolve) => {
        const sub = mailbox.subscribe(clientAddress, (msg) => {
          // 在严格模式下，如果没有 req-id，服务端会回传 msg.body.error
          if (msg.body?.error) {
            sub.unsubscribe();
            resolve(msg.body);
          }
        });
      });

      // 手动构造一个没有 req-id 的请求
      await mailbox.post({
        from: clientAddress,
        to: serverAddress,
        body: { a: 1, b: 2 },
        headers: {
          'rpc-func': 'calculator',
          'rpc-act': 'post',
          // 故意不传 'req-id'
        }
      });

      const response = await responsePromise;
      expect(response.error.message).toContain('missing req-id in headers (Strict Mode)');
      expect(response.error.code).toBe(400);
    });

    it('should allow request without req-id when strict: false (Fallback Mode)', async () => {
      const fallbackServerAddress = 'mem://fallback-server/api';
      const fallbackServer = new V2MailboxServerTransport({
        mailbox,
        apiUrl: fallbackServerAddress,
        strict: false // 禁用严格模式
      });
      fallbackServer.dispatcher.registry = ServerTools;
      fallbackServer.addRpcHandler(fallbackServerAddress);
      await fallbackServer.start();

      const responsePromise = new Promise<any>((resolve) => {
        const sub = mailbox.subscribe(clientAddress, (msg) => {
          // 这里检查 msg.headers['req-id'] 是否等于原始消息的 id
          if (msg.headers?.['req-id']?.startsWith('msg-')) {
            sub.unsubscribe();
            resolve(msg.body);
          }
        });
      });

      await mailbox.post({
        id: 'msg-fallback-test',
        from: clientAddress,
        to: fallbackServerAddress,
        body: { a: 5, b: 5 },
        headers: {
          'rpc-func': 'calculator',
          'rpc-act': 'post',
        }
      });

      const result = await responsePromise;
      expect(result).toBe(10);
      await fallbackServer.stop();
    });

    it('should isolate tasks in RpcActiveTaskTracker using req-id', async () => {
      // 注册一个长耗时工具
      new ServerTools({
        name: 'longTask',
        isApi: true,
        timeout: { value: 200, keepAliveOnTimeout: true },
        func: async () => {
          await new Promise(r => setTimeout(r, 10));
          return 'done';
        },
      } as ServerFuncItem).register();

      // 发送两个内容相同但 req-id 不同的请求
      const req1 = clientTransport.fetch('longTask', {}, 'post', undefined, { headers: { 'req-id': 'task-1' } });
      const req2 = clientTransport.fetch('longTask', {}, 'post', undefined, { headers: { 'req-id': 'task-2' } });

      // 在 V2 Dispatcher 中，它们应该由于 req-id 不同而互不干扰
      const [res1, res2] = await Promise.all([req1, req2]);

      // 注意：如果 keepAliveOnTimeout 触发，返回的是状态对象
      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
    });
  });
});
