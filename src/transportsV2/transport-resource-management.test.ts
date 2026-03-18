import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpServerToolTransport } from './http-server';
import { RpcTransportManager } from './manager';
import { ServerToolTransport } from './server';
import http from 'http';

describe('Transport V2 Resource Management & Multiplexing', () => {
  const PORT = 3004;
  const BASE_URL = `http://localhost:${PORT}`;

  describe('1. Architecture Transparency', () => {    it('getListenAddr should define physical base', () => {
      const t1 = new HttpServerToolTransport({ apiUrl: 'http://localhost:3001/v1' });
      expect(t1.getListenAddr()).toBe('localhost:3001');

      const t2 = new HttpServerToolTransport({ apiUrl: 'http://0.0.0.0:3002/api' });
      expect(t2.getListenAddr()).toBe(':3002');
    });

    it('getRoutes should define logical scope', () => {
      const t1 = new HttpServerToolTransport({ apiUrl: 'http://localhost:3001/v1' });
      // Verify default before handler
      expect(t1.getRoutes()).toEqual(['/']);

      // Verify specific route after adding handler
      t1.addRpcHandler('http://localhost:3001/v1');
      expect(t1.getRoutes()).toEqual(['/v1/']);
    });
  });

  describe('2. Manager Audit Responsibility', () => {
    let manager: RpcTransportManager;

    beforeEach(() => {
      manager = new RpcTransportManager();
      // Clear audit table manually as it's private and we are testing a fresh scenario
      (manager as any).routeAudit.clear();
    });

    it('should intercept routing conflicts', () => {
      const t1 = new HttpServerToolTransport({ apiUrl: 'http://localhost:3003/api' });
      t1.addRpcHandler('http://localhost:3003/api');

      const t2 = new HttpServerToolTransport({ apiUrl: 'http://localhost:3003/api' });
      t2.addRpcHandler('http://localhost:3003/api'); // Same route

      manager.addServer(t1);

      expect(() => {
        manager.addServer(t2);
      }).toThrow(/Routing Conflict/);
    });

    it('should allow different routes on same port', () => {
      const t1 = new HttpServerToolTransport({ apiUrl: 'http://localhost:3003/v1' });
      t1.addRpcHandler('http://localhost:3003/v1');

      const t2 = new HttpServerToolTransport({ apiUrl: 'http://localhost:3003/v2' });
      t2.addRpcHandler('http://localhost:3003/v2');

      expect(() => {
        manager.addServer(t1);
        manager.addServer(t2);
      }).not.toThrow();
    });
  });

  describe('3. HTTP Physical Multiplexing', () => {

    afterEach(async () => {      // Clean up shared servers
      const map = (HttpServerToolTransport as any).sharedServers;
      for (const binding of map.values()) {
        if (binding.server.listening) {
          await new Promise<void>(resolve => binding.server.close(resolve));
        }
      }
      map.clear();
    });

    it('should share underlying http.Server', async () => {
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1` });
      t1.addRpcHandler(`${BASE_URL}/v1`);

      const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v2` });
      t2.addRpcHandler(`${BASE_URL}/v2`);

      await t1.start();
      await t2.start();

      const server1 = t1.getRaw();
      const server2 = t2.getRaw();

      expect(server1).toBeDefined();
      expect(server1).toBe(server2); // Physical reuse
    });

    it('should route based on longest prefix', async () => {
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/api` });
      t1.addRpcHandler(`${BASE_URL}/api`); // /api/

      const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/api/v2` });
      t2.addRpcHandler(`${BASE_URL}/api/v2`); // /api/v2/

      // Mock internal handlers to verify routing
      const handle1 = vi.fn();
      const handle2 = vi.fn();
      (t1 as any).handleInternalRequest = handle1;
      (t2 as any).handleInternalRequest = handle2;

      await t1.start();
      await t2.start();

      const server = t1.getRaw();
      expect(server).toBeDefined();

      // Simulate request
      const req1 = { url: '/api/resource', headers: {} } as any;
      const res1 = { end: vi.fn(), setHeader: vi.fn() } as any;
      server!.emit('request', req1, res1);
      expect(handle1).toHaveBeenCalled();
      expect(handle2).not.toHaveBeenCalled();

      vi.clearAllMocks();

      const req2 = { url: '/api/v2/resource', headers: {} } as any;
      const res2 = { end: vi.fn(), setHeader: vi.fn() } as any;
      server!.emit('request', req2, res2);
      expect(handle2).toHaveBeenCalled();
      expect(handle1).not.toHaveBeenCalled();
    });

    it('should handle reference counting and lifecycle', async () => {
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1` });
      t1.addRpcHandler(`${BASE_URL}/v1`);

      const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v2` });
      t2.addRpcHandler(`${BASE_URL}/v2`);

      await t1.start();
      await t2.start();

      const server = t1.getRaw();
      const closeSpy = vi.spyOn(server!, 'close');

      await t1.stop();
      expect(closeSpy).not.toHaveBeenCalled(); // Still one user (t2)
      expect((HttpServerToolTransport as any).sharedServers.has(`localhost:${PORT}`)).toBe(true);

      await t2.stop();
      expect(closeSpy).toHaveBeenCalled(); // Should close now
      expect((HttpServerToolTransport as any).sharedServers.has(`localhost:${PORT}`)).toBe(false);
    });

    describe('3.1 Advanced Edge Cases', () => {
      it('should handle trailing slash normalization in routing', async () => {
        const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1/` });
        t1.addRpcHandler(`${BASE_URL}/v1/`);

        const handle = vi.fn();
        (t1 as any).handleInternalRequest = handle;
        await t1.start();

        const server = t1.getRaw()!;

        // Request WITHOUT trailing slash should still match /v1/
        const req = { url: '/v1', headers: {} } as any;
        const res = { end: vi.fn(), setHeader: vi.fn() } as any;
        server.emit('request', req, res);

        // Note: Current implementation might need adjustment if this fails
        // We are testing the intent of "logical prefix"
        expect(handle).toHaveBeenCalled();
        await t1.stop();
      });

      it('should route based on longest prefix with deep nesting', async () => {
        const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/` });
        t1.addRpcHandler(`${BASE_URL}/`); // /

        const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/api/` });
        t2.addRpcHandler(`${BASE_URL}/api/`); // /api/

        const t3 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/api/v2/` });
        t3.addRpcHandler(`${BASE_URL}/api/v2/`); // /api/v2/

        const handle1 = vi.fn();
        const handle2 = vi.fn();
        const handle3 = vi.fn();
        (t1 as any).handleInternalRequest = handle1;
        (t2 as any).handleInternalRequest = handle2;
        (t3 as any).handleInternalRequest = handle3;

        await t1.start();
        await t2.start();
        await t3.start();

        const server = t1.getRaw()!;

        // Request /api/v2/resource -> should hit t3
        server.emit('request', { url: '/api/v2/resource', headers: {} }, { end: vi.fn(), setHeader: vi.fn() });
        expect(handle3).toHaveBeenCalled();
        expect(handle2).not.toHaveBeenCalled();
        expect(handle1).not.toHaveBeenCalled();

        vi.clearAllMocks();

        // Request /api/other -> should hit t2
        server.emit('request', { url: '/api/other', headers: {} }, { end: vi.fn(), setHeader: vi.fn() });
        expect(handle2).toHaveBeenCalled();
        expect(handle1).not.toHaveBeenCalled();
        expect(handle3).not.toHaveBeenCalled();

        vi.clearAllMocks();

        // Request /random -> should hit t1 (root)
        server.emit('request', { url: '/random', headers: {} }, { end: vi.fn(), setHeader: vi.fn() });
        expect(handle1).toHaveBeenCalled();

        await t1.stop();
        await t2.stop();
        await t3.stop();
      });

      it('should treat localhost, 127.0.0.1 and [::1] as the same physical base', async () => {
        const t1 = new HttpServerToolTransport({ apiUrl: `http://localhost:${PORT}/v1` });
        const t2 = new HttpServerToolTransport({ apiUrl: `http://127.0.0.1:${PORT}/v2` });
        const t3 = new HttpServerToolTransport({ apiUrl: `http://[::1]:${PORT}/v3` });

        expect(t1.getListenAddr()).toBe(`localhost:${PORT}`);
        expect(t2.getListenAddr()).toBe(`localhost:${PORT}`);
        expect(t3.getListenAddr()).toBe(`localhost:${PORT}`); // Normalized [::1] to localhost

        await t1.start();
        await t2.start();
        await t3.start();

        expect(t1.getRaw()).toBe(t2.getRaw());
        expect(t1.getRaw()).toBe(t3.getRaw());

        await t1.stop();
        await t2.stop();
        await t3.stop();
      });

      it('should migrate defaultInstance when the primary one stops', async () => {
        const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1` });
        t1.addRpcHandler(`${BASE_URL}/v1`);
        const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v2` });
        t2.addRpcHandler(`${BASE_URL}/v2`);

        await t1.start(); // t1 becomes defaultInstance
        await t2.start();

        const addr = t1.getListenAddr();
        const binding = (HttpServerToolTransport as any).sharedServers.get(addr);
        expect(binding.defaultInstance).toBe(t1);

        await t1.stop();
        expect(binding.defaultInstance).toBe(t2); // Migrated to the remaining instance

        await t2.stop();
      });
    });
    it('should handle concurrent start of shared servers safely', async () => {
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1` });
      t1.addRpcHandler(`${BASE_URL}/v1`);
      const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v2` });
      t2.addRpcHandler(`${BASE_URL}/v2`);

      // Concurrent start
      await Promise.all([t1.start(), t2.start()]);

      expect(t1.getRaw()).toBe(t2.getRaw());
      expect((HttpServerToolTransport as any).sharedServers.get(t1.getListenAddr()).refCount).toBe(2);

      await t1.stop();
      await t2.stop();
    });

    it('should integrate with RpcTransportManager for global stopAll', async () => {
      const manager = new RpcTransportManager();
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1` });
      t1.addRpcHandler(`${BASE_URL}/v1`);

      manager.addServer(t1);
      await t1.start();

      const addr = t1.getListenAddr();
      expect((HttpServerToolTransport as any).sharedServers.has(addr)).toBe(true);

      await manager.stopAll();

      expect((HttpServerToolTransport as any).sharedServers.has(addr)).toBe(false);
      expect(t1.getRaw()).toBeUndefined();
    });
  });

  describe('4. Comprehensive Audit & Multi-Route', () => {
    it('should audit multiple routes in a single transport', () => {
      const manager = new RpcTransportManager();
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/api` });
      t1.addRpcHandler(`${BASE_URL}/api/v1`);
      t1.addDiscoveryHandler(`${BASE_URL}/api/info`, () => ({}));

      manager.addServer(t1);

      const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/api` });
      t2.addRpcHandler(`${BASE_URL}/api/v1`); // Conflict with t1's RPC route

      expect(() => manager.addServer(t2)).toThrow(/Routing Conflict/);
    });

    it('should allow overlapping physical address with distinct logical routes', () => {
      const manager = new RpcTransportManager();
      const t1 = new HttpServerToolTransport({ apiUrl: `http://localhost:${PORT}/t1` });
      t1.addRpcHandler(`http://localhost:${PORT}/t1`);

      const t2 = new HttpServerToolTransport({ apiUrl: `http://127.0.0.1:${PORT}/t2` });
      t2.addRpcHandler(`http://127.0.0.1:${PORT}/t2`);

      // Audit should pass because although they resolve to same localhost:PORT, paths /t1/ and /t2/ are distinct
      expect(() => {
        manager.addServer(t1);
        manager.addServer(t2);
      }).not.toThrow();
    });
  });

  describe('6. Streaming & Robustness', () => {
    it('should handle streaming response without interference from other transports', async () => {
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1` });
      t1.addRpcHandler(`${BASE_URL}/v1`);
      
      const t2 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v2` });
      t2.addRpcHandler(`${BASE_URL}/v2`);

      await t1.start();
      await t2.start();

      const server = t1.getRaw()!;
      const { Readable, PassThrough } = require('stream');

      // Mock a streaming RPC call on t1
      const mockStream = new Readable({
        read() {
          this.push('chunk1');
          this.push(null);
        }
      });

      (t1 as any).processIncomingCall = async (req: any, res: any) => {
        res.statusCode = 200;
        mockStream.pipe(res);
      };

      // Use PassThrough to simulate a real writable response stream
      const res = new PassThrough() as any;
      res.statusCode = 0;
      res.setHeader = vi.fn();
      
      // Request t1/v1
      server.emit('request', { url: '/v1/call', method: 'POST', headers: {} }, res);

      // Verify stream was piped (simple check: statusCode set)
      expect(res.statusCode).toBe(200);

      // Even if t2 stops, t1's server should stay alive
      await t2.stop();
      expect(server.listening).toBe(true);

      await t1.stop();
    });

    it('should return 404 for unmatched routes in shared server', async () => {
      const t1 = new HttpServerToolTransport({ apiUrl: `${BASE_URL}/v1` });
      t1.addRpcHandler(`${BASE_URL}/v1`);
      await t1.start();

      const server = t1.getRaw()!;
      const res = { 
        statusCode: 0, 
        setHeader: vi.fn(), 
        end: vi.fn() 
      } as any;

      // Request unknown route /v3
      server.emit('request', { url: '/v3', headers: {} }, res);

      expect(res.statusCode).toBe(404);
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('Not Found'));

      await t1.stop();
    });
  });

  describe('7. Mailbox Rigor', () => {
    // Create a minimal concrete implementation of ServerToolTransport
    // that mimics MailboxServerTransport behavior regarding getRoutes (using default)
    class MockMailboxTransport extends ServerToolTransport {
      apiUrl: string;
      constructor(url: string) {
        super();
        this.apiUrl = url;
      }
      toRpcRequest(raw: any) { return Promise.resolve({} as any); }
      sendRpcResponse() { return Promise.resolve(); }
      addDiscoveryHandler() { }
      addRpcHandler() { }
      _start() { return Promise.resolve(); }
      stop() { return Promise.resolve(); }
    }

    it('should default to root route ["/"]', () => {
      const mb = new MockMailboxTransport('mailbox://user1');
      expect(mb.getRoutes()).toEqual(['/']);
    });

    it('should cause conflict for same address', () => {
      const manager = new RpcTransportManager();
      (manager as any).routeAudit.clear();

      const mb1 = new MockMailboxTransport('mailbox://common');
      const mb2 = new MockMailboxTransport('mailbox://common');

      manager.addServer(mb1);
      expect(() => {
        manager.addServer(mb2);
      }).toThrow(/Routing Conflict/);
    });
  });

});

