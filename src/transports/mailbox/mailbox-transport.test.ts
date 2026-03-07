import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Mailbox, MemoryProvider, MailMessage } from '@mboxlabs/mailbox';

import { ServerTools } from '../../server-tools';
import { ResServerTools } from '../../res-server-tools';
import { ClientTools } from '../../client-tools';
import { ResClientTools } from '../../res-client-tools';
import { MailboxServerTransport } from './server';
import { MailboxClientTransport } from './client';

describe('MailboxServerTransport / MailboxClientTransport Test', () => {
  let mailbox: Mailbox;
  let serverTransport: MailboxServerTransport;
  let clientTransport: MailboxClientTransport;

  const serverAddress = 'mem://api@server/api';
  const clientAddress = 'mem://user@client/inbox';

  beforeAll(async () => {
    // Reset registries to avoid test interference
    ServerTools.items = {};
    ClientTools.items = {};
    ResClientTools.items = ClientTools.items; // Ensure shared items

    mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());

    // 1. Register tools on server
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

    // 2. Setup server transport (default Push mode)
    serverTransport = new MailboxServerTransport({ mailbox, address: serverAddress });
    serverTransport.mount(ServerTools);
    await serverTransport.start();

    // 3. Setup client transport
    clientTransport = new MailboxClientTransport({
      mailbox,
      apiRoot: serverAddress,
      clientAddress: clientAddress,
      timeout: 1000,
    });

    // Mount the transport to activate the client subscription
    await clientTransport.mount(ClientTools);
    ResClientTools.setTransport(clientTransport);
  });

  afterAll(async () => {
    await serverTransport.stop();
    await clientTransport.stop();
  });

  it('should load APIs via discovery', async () => {
    await ClientTools.loadFrom();

    const calculator = ClientTools.get('calculator');
    expect(calculator).toBeDefined();

    const errorTool = ClientTools.get('errorTool');
    expect(errorTool).toBeDefined();
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

  it('should allow tool to access sender information via context', async () => {
    new ServerTools({
      name: 'whoami',
      isApi: true,
      func: (params) => {
        const message = params._req as MailMessage;
        return { sender: message.from?.href };
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
      get(params: any) {
        return { resId: params.id, name: 'Alice' };
      }
    }
    new UserResTool('users', { isApi: true }).register();

    await ResClientTools.loadFrom();
    const userTool = ResClientTools.get('users');

    const user = await userTool!.fetch({ id: '123' }, 'get');
    expect(user).toEqual({ resId: '123', name: 'Alice' });
  });

  it('should work in Pull mode', async () => {
    const pullServerAddress = 'mem://pull-server/api';
    const pullServer = new MailboxServerTransport({
      mailbox,
      address: pullServerAddress,
      mode: 'pull',
      pullInterval: 10
    });

    new ServerTools({
      name: 'pullTester',
      isApi: true,
      func: () => 'pull-success',
    }).register();

    pullServer.mount(ServerTools);
    await pullServer.start();

    const pullClient = new MailboxClientTransport({
      mailbox,
      apiRoot: pullServerAddress,
      clientAddress: 'mem://pull-client/inbox',
      timeout: 2000,
    });
    await pullClient.mount(ClientTools);

    const result = await pullClient.fetch('pullTester');
    expect(result).toBe('pull-success');

    await pullServer.stop();
    await pullClient.stop();
    // Restore original transport
    ClientTools.setTransport(clientTransport);
    ResClientTools.setTransport(clientTransport);
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
        'mbx-req-id': 'redirect-test'
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
        headers: { 'mbx-fn-id': 'backlog-adder', 'mbx-req-id': `backlog-${i}`, 'mbx-act': 'post' }
      });
    }

    // Use globalThis to be 'relocation-proof' (serialization safe)
    (globalThis as any).backlogProcessedCount = 0;
    new ServerTools({
      name: 'backlog-adder',
      isApi: true,
      func: () => {
        (globalThis as any).backlogProcessedCount++;
        return 'ok';
      },
    }).register();

    const pullServer = new MailboxServerTransport({
      mailbox,
      address: backlogAddress,
      mode: 'pull',
      pullInterval: 5
    });
    pullServer.mount(ServerTools);
    await pullServer.start();

    await new Promise(resolve => setTimeout(resolve, 200));
    expect((globalThis as any).backlogProcessedCount).toBe(msgCount);

    // Cleanup
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
      func: (params) => {
        const message = params._req as MailMessage;
        return {
          custom: message.headers?.['mbx-custom-field'],
          traceId: message.headers?.['mbx-trace-id'],
        };
      },
    }).register();

    await ClientTools.loadFrom();
    const result = await clientTransport.fetch('headerInspector', {}, 'post', undefined, {
      headers: {
        'mbx-custom-field': 'hello-world',
        'mbx-trace-id': 'trace-123'
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
        if (msg.headers?.['mbx-req-id'] === 'no-fn-id') {
          sub.unsubscribe();
          resolve(msg.body);
        }
      });
    });

    await mailbox.post({
      from: clientAddress,
      to: serverAddress,
      body: { some: 'data' },
      headers: { 'mbx-req-id': 'no-fn-id' }
    });

    const response = await responsePromise;
    expect(response.error).toContain("missing 'mbx-fn-id' in headers");
    expect(response.code).toBe(400);
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
        'mbx-req-id': 'fallback-test'
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
      func: (params) => params.data,
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
      headers: { 'mbx-fn-id': 'calculator', 'mbx-act': 'post', 'mbx-req-id': 'restart-test' }
    });

    const responsePromise = new Promise<any>((resolve) => {
      const sub = mailbox.subscribe(clientAddress, (msg) => {
        if (msg.headers?.['mbx-req-id'] === 'restart-test') {
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
    const stopTransport = new MailboxClientTransport({
      mailbox,
      apiRoot: 'mem://nobody-listener/api',
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
});
