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
      func: () => { throw new Error('server-side error') },
    }).register();

    // 2. Setup server transport
    serverTransport = new MailboxServerTransport({ mailbox, address: serverAddress });
    serverTransport.mount(ServerTools, '/api');
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
    expect(calculator).toBeInstanceOf(ClientTools);
    
    const errorTool = ClientTools.get('errorTool');
    expect(errorTool).toBeDefined();
  });

  it('should call remote tool and get result', async () => {
    const calculator = ClientTools.get('calculator');
    const result = await calculator!.run({ a: 10, b: 32 });
    expect(result).toBe(42);
  });

  it('should handle remote errors', async () => {
    const errorTool = ClientTools.get('errorTool');
    await expect(errorTool!.run({})).rejects.toThrow('server-side error');
  });

  it('should handle concurrent requests correctly', async () => {
    const calculator = ClientTools.get('calculator');
    
    const results = await Promise.all([
      calculator!.run({ a: 1, b: 1 }),
      calculator!.run({ a: 10, b: 20 }),
      calculator!.run({ a: 100, b: 200 }),
    ]);

    expect(results).toEqual([2, 30, 300]);
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

  it('should support discovery via "list" action', async () => {
    const items = await clientTransport.fetch('', {}, 'list');
    expect(items).toHaveProperty('calculator');
    expect(items).toHaveProperty('whoami');
  });

  it('should support RESTful style call with id (subName)', async () => {
    class UserResTool extends ResServerTools {
      get(params: any) {
        return { id: params.id, name: 'Alice' };
      }
    }
    new UserResTool('users', { isApi: true }).register();

    await ResClientTools.loadFrom();
    const userTool = ResClientTools.get('users');
    expect(userTool).toBeInstanceOf(ResClientTools);
    
    // Call via ResClientTools style, passing id in the first parameter
    const user = await userTool!.fetch({ id: '123', some: 'args' }, 'get');
    expect(user).toEqual({ id: '123', name: 'Alice' });
  });

  it('should pass custom headers through transport fetch', async () => {
    new ServerTools({
      name: 'headerChecker',
      isApi: true,
      func: (params) => {
        const message = params._req as MailMessage;
        return { customHeader: message.headers?.['mbx-custom-header'] };
      },
    }).register();

    await ClientTools.loadFrom();
    const result = await clientTransport.fetch('headerChecker', {}, 'post', undefined, {
      headers: { 'mbx-custom-header': 'hello-mailbox' }
    });
    
    expect(result.customHeader).toBe('hello-mailbox');
  });

  it('should handle large and complex JSON payloads', async () => {
    const complexData = {
      array: [1, 2, { nested: true }],
      obj: { a: 'b', c: [10, 20] },
      longString: 'a'.repeat(1000),
    };

    new ServerTools({
      name: 'echo',
      isApi: true,
      func: (params) => params.data,
    }).register();

    await ClientTools.loadFrom();
    const result = await ClientTools.get('echo')!.run({ data: complexData });
    expect(result).toEqual(complexData);
  });

  it('should reject pending requests when transport is stopped', async () => {
    const stopTransport = new MailboxClientTransport({
      mailbox,
      apiRoot: 'mem://nobody-listener/api',
      clientAddress: 'mem://stopper@client/inbox',
      timeout: 5000,
    });
    // Manually trigger subscription without full mount
    (stopTransport as any).subscription = mailbox.subscribe(
      (stopTransport as any).clientAddress, 
      (stopTransport as any).onResponse.bind(stopTransport)
    );
    
    const promise = stopTransport.fetch('any-tool');
    await stopTransport.stop();
    
    await expect(promise).rejects.toThrow('Transport stopped');
  });

  it('should handle timeout', async () => {
    const timeoutTransport = new MailboxClientTransport({
      mailbox,
      apiRoot: 'mem://none@server/api',
      clientAddress: 'mem://timeout@client/inbox',
      timeout: 100,
    });
    // Manually trigger subscription without full mount
    (timeoutTransport as any).subscription = mailbox.subscribe(
      (timeoutTransport as any).clientAddress, 
      (timeoutTransport as any).onResponse.bind(timeoutTransport)
    );
    
    await expect(timeoutTransport.fetch('any')).rejects.toThrow('Request timeout');
  });

  it('should post a message and receive it via subscribe', async () => {
    const toAddress = 'mem://user@service/inbox';
    const fromAddress = 'mem://user@client';
    const messageBody = { content: 'Hello, World!' };

    const onReceive = vi.fn();
    mailbox.subscribe(toAddress, onReceive);

    await mailbox.post({
      from: fromAddress,
      to: toAddress,
      body: messageBody,
    });

    // Need to wait a bit for the async post and event loop
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onReceive).toHaveBeenCalledOnce();
    const receivedMessage: MailMessage = onReceive.mock.calls[0][0];
    expect(receivedMessage.body).toEqual(messageBody);
    expect(receivedMessage.from.toString()).toBe(fromAddress);
    expect(receivedMessage.to.toString()).toBe(toAddress);
    expect(receivedMessage.headers).toHaveProperty('mbx-sent-at');
  });
});
