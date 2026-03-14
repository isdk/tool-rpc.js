import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RpcTransportManager } from './manager';
import { ToolTransport, IToolTransport } from './base';
import { IClientToolTransport } from './client';
import { IServerToolTransport } from './server';

// Mock Transport Classes
class MockClientTransport extends ToolTransport implements IClientToolTransport {
  constructor(public apiUrl: string, options?: any) {
    super(options);
  }
  loadApis = vi.fn();
  fetch = vi.fn();
  stop = vi.fn().mockResolvedValue(undefined);
  toObject = vi.fn();
}

class MockServerTransport extends ToolTransport implements IServerToolTransport {
  dispatcher: any = { dispatch: vi.fn() };
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn().mockResolvedValue(undefined);
  addDiscoveryHandler = vi.fn();
  addRpcHandler = vi.fn();
  getRaw = vi.fn();
}

describe('RpcTransportManager', () => {
  let manager: RpcTransportManager;

  beforeEach(() => {
    // Reset singleton state if possible or use a fresh instance for testing
    // Since RpcTransportManager uses a private constructor, we might need a workaround
    // or just rely on fresh Manager if it wasn't a strict singleton.
    // However, for testing, we can just create a new one.
    manager = new RpcTransportManager();
    // Also reset static scheme registry/resolvers to be clean
    (RpcTransportManager as any).schemeRegistry.clear();
    (RpcTransportManager as any).schemeResolvers = [];
  });

  it('should implement singleton pattern via .instance', () => {
    const instance1 = RpcTransportManager.instance;
    const instance2 = RpcTransportManager.instance;
    expect(instance1).toBe(instance2);
    expect(instance1).toBeInstanceOf(RpcTransportManager);
  });

  describe('Protocol Management', () => {
    it('should register and instantiate scheme classes via bindScheme', () => {
      RpcTransportManager.bindScheme('mock', MockClientTransport);

      const apiUrl = 'mock://localhost/api';
      const client = manager.getClient(apiUrl);

      expect(client).toBeInstanceOf(MockClientTransport);
      expect(client.apiUrl).toBe(apiUrl);
    });

    it('should support multiple schemes in bindScheme', () => {
      RpcTransportManager.bindScheme(['s1', 's2'], MockClientTransport);
      expect(manager.getClient('s1://host')).toBeInstanceOf(MockClientTransport);
      expect(manager.getClient('s2://host')).toBeInstanceOf(MockClientTransport);
    });

    it('should support dynamic scheme resolvers', () => {
      RpcTransportManager.bindScheme((scheme) => {
        if (scheme === 'dynamic') return MockClientTransport;
      });

      const client = manager.getClient('dynamic://host');
      expect(client).toBeInstanceOf(MockClientTransport);
      
      // Should also be cached in registry now
      expect((RpcTransportManager as any).schemeRegistry.has('dynamic')).toBe(true);
    });

    it('should throw error for unregistered scheme', () => {
      expect(() => manager.getClient('unknown://host')).toThrow(/Unsupported URL scheme: unknown/);
    });

    it('should be case-insensitive for schemes', () => {
      RpcTransportManager.bindScheme('UPPER', MockClientTransport);
      expect(manager.getClient('upper://host')).toBeInstanceOf(MockClientTransport);
      expect(manager.getClient('uPpEr://host')).toBeInstanceOf(MockClientTransport);
    });

    it('should resolve through a chain of resolvers in order', () => {
      const resolver1 = vi.fn().mockReturnValue(null);
      const resolver2 = vi.fn().mockReturnValue(MockClientTransport);
      
      RpcTransportManager.bindScheme(resolver1);
      RpcTransportManager.bindScheme(resolver2);

      const client = manager.getClient('any://host');
      expect(client).toBeInstanceOf(MockClientTransport);
      expect(resolver1).toHaveBeenCalledWith('any');
      expect(resolver2).toHaveBeenCalledWith('any');
    });

    it('should handle resolver errors and continue to next resolver', () => {
      const errorResolver = () => { throw new Error('Boom'); };
      const successResolver = (s: string) => s === 'fix' ? MockClientTransport : null;

      RpcTransportManager.bindScheme(errorResolver);
      RpcTransportManager.bindScheme(successResolver);

      // Now it should NOT throw because we added try-catch in manager.ts
      const client = manager.getClient('fix://host');
      expect(client).toBeInstanceOf(MockClientTransport);
    });

    it('should pass options to transport constructor in getClient', () => {
      RpcTransportManager.bindScheme('opt', MockClientTransport);
      const options = { custom: 'value' };
      const client = manager.getClient('opt://host', options) as MockClientTransport;
      expect(client.options).toEqual(options);
    });

    it('should prioritize static registry over dynamic resolvers', () => {
      class StaticTransport extends ToolTransport {
        apiUrl: string = '';
        constructor(apiUrl: string, options?: any) { super(options); this.apiUrl = apiUrl; }
      }
      const resolver = vi.fn().mockReturnValue(MockClientTransport);
      RpcTransportManager.bindScheme('static', StaticTransport as any);
      RpcTransportManager.bindScheme(resolver);

      const client = manager.getClient('static://host');
      expect(client).toBeInstanceOf(StaticTransport);
      expect(client).not.toBeInstanceOf(MockClientTransport);
      expect(resolver).not.toHaveBeenCalled();
    });

    it('should query resolvers only once and cache the result', () => {
      const resolver = vi.fn().mockReturnValue(MockClientTransport);
      RpcTransportManager.bindScheme(resolver);

      manager.getClient('once://host');
      manager.getClient('once://host2');
      
      expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('should reuse instances for the same apiUrl', () => {
      RpcTransportManager.bindScheme('mock', MockClientTransport);
      const apiUrl = 'mock://localhost/api';

      const client1 = manager.getClient(apiUrl);
      const client2 = manager.getClient(apiUrl);

      expect(client1).toBe(client2);
    });
  });

  describe('Server Management', () => {
    it('should track and start server transports', async () => {
      const server = new MockServerTransport({ apiUrl: 'mock-srv://0.0.0.0' });
      manager.addServer(server);

      await manager.startAll({ some: 'config' });
      expect(server.start).toHaveBeenCalledWith({ some: 'config' });
    });

    it('should stop all servers and clients on stopAll', async () => {
      RpcTransportManager.bindScheme('mock', MockClientTransport);

      const client = manager.getClient('mock://client/api');
      const server = new MockServerTransport({ apiUrl: 'mock://server/api' });
      manager.addServer(server);

      await manager.stopAll(true);

      expect(server.stop).toHaveBeenCalledWith(true);
      expect(client.stop).toHaveBeenCalledWith(true);
    });

    it('should support generic close() for clients that lack stop()', async () => {
      const clientWithClose: any = {
        apiUrl: 'close://me',
        close: vi.fn()
      };
      manager.register(clientWithClose);

      await manager.stopAll();
      expect(clientWithClose.close).toHaveBeenCalled();
    });

    it('should handle partial failures during startAll', async () => {
      const server1 = new MockServerTransport({ apiUrl: 'mock://s1' });
      const server2 = new MockServerTransport({ apiUrl: 'mock://s2' });
      server2.start.mockRejectedValue(new Error('Start failed'));

      manager.addServer(server1);
      manager.addServer(server2);

      await expect(manager.startAll()).rejects.toThrow('Start failed');
      expect(server1.start).toHaveBeenCalled();
    });
  });

  describe('Isolation & Multi-instance', () => {
    it('should maintain separate instance caches for different managers', () => {
      const manager1 = new RpcTransportManager();
      const manager2 = new RpcTransportManager();
      RpcTransportManager.bindScheme('mock', MockClientTransport);

      const client1 = manager1.getClient('mock://host1');
      const client2 = manager2.getClient('mock://host1'); // Same URL, different manager

      expect(client1).not.toBe(client2);
      expect(manager1.getClient('mock://host1')).toBe(client1);
    });

    it('should share static protocol registry across managers', () => {
      const manager1 = new RpcTransportManager();
      const manager2 = new RpcTransportManager();
      RpcTransportManager.bindScheme('global', MockClientTransport);

      expect(manager1.getClient('global://test')).toBeInstanceOf(MockClientTransport);
      expect(manager2.getClient('global://test')).toBeInstanceOf(MockClientTransport);
    });
  });

  describe('Deep Validation & Security', () => {
    it('should block local loopback variation in validateRpcRequest', () => {
      const restrictedUrls = [
        'http://127.0.0.1/admin',
        'http://localhost/config',
        'http://169.254.169.254/metadata'
      ];

      // Now empty by default, so we must add patterns to test
      manager.addRestrictedPattern([
        /169\.254\.169\.254/,
        'localhost',
        '127.0.0.1'
      ]);

      restrictedUrls.forEach(url => {
        const req: any = { apiUrl: url, toolId: 'any' };
        expect(() => manager.validateRpcRequest(req)).toThrow(/forbidden|restricted/);
      });
    });

    it('should allow normal requests in validateRpcRequest', () => {
      const normalReq: any = {
        apiUrl: 'http://localhost:3000/api',
        toolId: 'test'
      };

      expect(() => manager.validateRpcRequest(normalReq)).not.toThrow();
    });

    it('should allow override of validation logic in subclasses', () => {
      class CustomManager extends RpcTransportManager {
        public override validateRpcRequest(request: any) {
          if (request.toolId === 'forbidden') throw new Error('Blocked by tool name');
        }
      }
      const myManager = new CustomManager();
      expect(() => myManager.validateRpcRequest({ apiUrl: 'http://ok', toolId: 'forbidden' } as any)).toThrow('Blocked by tool name');
    });
  });
});
