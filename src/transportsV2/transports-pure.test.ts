import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox';
import { Readable } from 'stream';

import { ServerTools } from '../server-tools';
import { RpcServerDispatcher } from './dispatcher';
import { HttpServerToolTransport } from './http-server';
import { MailboxServerTransport } from './mailbox-server';
import { MailboxClientTransport } from './mailbox-client';
import { ToolRpcContext, RpcStatusCode, RPC_HEADERS } from './models';
import { RpcActiveTaskTracker } from './task-tracker';
import { RpcMethodsServerTool } from '../rpc-methods-server-tool';

import { RpcTaskResource } from './rpc-task';

describe('Comprehensive Pure V2 Integration (Streaming, Polling, Errors)', () => {
  let mailbox: Mailbox;

  // Shared components
  let sharedTracker: RpcActiveTaskTracker;
  let sharedRegistry: any;

  // HTTP setup
  let httpPort: number;
  let httpDispatcher: RpcServerDispatcher;
  let httpTransport: HttpServerToolTransport;

  // Mailbox setup
  let mbxServerDispatcher: RpcServerDispatcher;
  let mbxServerTransport: MailboxServerTransport;
  let mbxClientTransport: MailboxClientTransport;

  const mbxServerAddr = 'mem://pure-v2-server/api';
  const mbxClientAddr = 'mem://pure-v2-client/inbox';

  beforeAll(async () => {
    mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());

    const pureCompat = { enableParamBridge: false, enableContextInjection: false };
    sharedTracker = new RpcActiveTaskTracker(5000);

    // 1. Setup Registries with Pure V2 Tools
    class ComplexV2Tool extends ServerTools {
      enableLegacyCompat = false;

      // Streaming Tool
      static streamTool = {
        stream: true,
        run: (params: any) => {
          return Readable.from([JSON.stringify({ chunk: 1 }), JSON.stringify({ chunk: 2 })]);
        }
      };

      // Long Running Tool (Triggers 102)
      static longTool = {
        timeout: { value: 50, keepAliveOnTimeout: true },
        run: async () => {
          await new Promise(r => setTimeout(r, 200));
          return { result: 'long-done' };
        }
      };

      // Error Tool
      static errorTool = {
        run: () => {
          const err: any = new Error('Pure V2 Error');
          err.code = 418;
          throw err;
        }
      };
    }

    sharedRegistry = {
      get: (id: string) => {
        // Removed manual rpcTask registration to test automatic systemRegistry fallback
        return (ComplexV2Tool as any)[id];
      }
    };

    // 2. Initialize HTTP
    httpDispatcher = new RpcServerDispatcher({
      registry: sharedRegistry,
      compat: pureCompat,
      tracker: sharedTracker
    });
    httpTransport = new HttpServerToolTransport({
      dispatcher: httpDispatcher,
    });
    httpTransport.addRpcHandler('http://localhost/api/');
    await httpTransport.start({ port: 0 });
    const rawServer = httpTransport.getRaw()!;
    httpPort = (rawServer.address() as any).port;

    // 3. Initialize Mailbox
    mbxServerDispatcher = new RpcServerDispatcher({
      registry: sharedRegistry,
      compat: pureCompat,
      tracker: sharedTracker
    });
    mbxServerTransport = new MailboxServerTransport({ mailbox, address: mbxServerAddr, dispatcher: mbxServerDispatcher });
    await mbxServerTransport.start();

    mbxClientTransport = new MailboxClientTransport({
      mailbox,
      serverAddress: mbxServerAddr,
      clientAddress: mbxClientAddr
    });
    await mbxClientTransport.start();
  });

  afterAll(async () => {
    await httpTransport.stop(true);
    await mbxServerTransport.stop();
    await mbxClientTransport.stop();
  });

  describe('Feature: Streaming', () => {
    it('should support streaming in pure V2 via HTTP', async () => {
      const resp = await fetch(`http://localhost:${httpPort}/api/streamTool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: true })
      });
      const reader = resp.body!.getReader();
      let content = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += new TextDecoder().decode(value);
      }
      expect(content).toContain('{"chunk":1}');
      expect(content).toContain('{"chunk":2}');
    });
  });

  describe('Feature: Polling / Background Tasks (102 Processing)', () => {
    it('should handle background task transition and polling in pure V2 via Mailbox', async () => {
      // mbxClientTransport uses executeWithPolling internally
      const result = await mbxClientTransport.fetch('longTool', { x: 1 });
      expect(result).toEqual({ result: 'long-done' });
    });

    it('should handle background task via HTTP manually', async () => {
      // First call -> should return 102
      const resp1 = await fetch(`http://localhost:${httpPort}/api/longTool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const body1 = await resp1.json();
      // 在 HTTP 传输层，为了 fetch 兼容性，物理状态码映射为 202
      expect(resp1.status).toBe(202);
      // 业务负载内部依然携带 102 信号
      expect(body1.status).toBe(102);

      const requestId = resp1.headers.get(RPC_HEADERS.REQUEST_ID);
      expect(requestId).toBeTruthy();

      // Verify rpc-retry-after is present
      expect(resp1.headers.get(RPC_HEADERS.RETRY_AFTER)).toBeTruthy();

      // Poll for status
      let completed = false;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 100));
        const respPoll = await fetch(`http://localhost:${httpPort}/api/rpcTask/get`, {
          headers: { [RPC_HEADERS.RES_ID]: requestId! }
        });
        const pollStatus = respPoll.status;
        const pollBody = await respPoll.json();

        if (pollStatus === 200) {
          expect(pollBody).toEqual({ result: 'long-done' });
          completed = true;
          break;
        }
      }
      expect(completed).toBe(true);
    });
  });

  describe('Feature: Error Handling', () => {
    it('should preserve structured errors in pure V2', async () => {
      const resp = await fetch(`http://localhost:${httpPort}/api/errorTool`);
      const body = await resp.json();
      expect(resp.status).toBe(418);
      expect(body.error.message).toBe('Pure V2 Error');
    });
  });

  describe('Feature: Metadata Propagation', () => {
    it('should pass resId and act via ToolRpcContext in pure V2', async () => {
      class MetaTool extends ServerTools {
        enableLegacyCompat = false;
        func(params: any, context: ToolRpcContext) {
          return { resId: context.resId, act: context.act };
        }
      }
      httpDispatcher.registry.get = (id: string) => id === 'meta' ? new MetaTool('meta') : undefined;

      const resp = await fetch(`http://localhost:${httpPort}/api/meta/res-abc`, {
        headers: { 'rpc-act': 'my-act' }
      });
      const data = await resp.json();
      expect(data.resId).toBe('res-abc');
      expect(data.act).toBe('my-act');
    });
  });
});
