// @vitest-environment node
// import { describe, expect, it } from 'vitest'

import { describe, expect, it, vi } from 'vitest'
import { ClientTools as ToolFunc } from "../src/client-tools"
import { RpcClientTransportManager } from "../src/transports/client-manager"

describe('ClientTools', () => {
  beforeEach(() => {
    ToolFunc.items = {}
  })
  it('should register a func with named params', async () => {
    const params = { "a": "any", b: "any" }
    ToolFunc.register({
      name: 'test',
      params,
      func: ({ a, b }: { a: any, b: any }) => {
        return a > 15 ? b : a
      }
    })
    expect(ToolFunc.items['test']).toBeInstanceOf(ToolFunc)
    const result = ToolFunc.get('test')
    expect(result).toBeInstanceOf(ToolFunc)
    expect(result.name).toBe('test')
    expect(result.params).toStrictEqual(params)
    expect(result.func).toBeInstanceOf(Function)

    expect(result.runWithPosSync(1)).toStrictEqual(1)
    expect(await result.runWithPos(12)).toStrictEqual(12)
    expect(await result.runWithPos(118, 6)).toStrictEqual(6)

    expect(result.runWithPosSync({ "a": 1 })).toStrictEqual(1)
    expect(await result.runWithPos({ "a": 12 })).toStrictEqual(12)
    expect(await result.runWithPos({ "a": 118, b: 6 })).toStrictEqual(6)

    expect(result.runSync({ "a": 1 })).toStrictEqual(1)
    expect(await result.run({ "a": 12 })).toStrictEqual(12)
    expect(await result.run({ "a": 118, b: 6 })).toStrictEqual(6)

    expect(result.runAsSync('test', { "a": 1, "b": 2 })).toStrictEqual(1)
    expect(await result.runWithPosAs('test', 118, 6)).toStrictEqual(6)
    expect(await result.runWithPosAs('test', { "a": 118, b: 6 })).toStrictEqual(6)

    let fn = result.getFuncWithPos()
    expect(fn(118, 6)).toStrictEqual(6)
    expect(fn({ "a": 1 })).toStrictEqual(1)

    fn = result.getFunc()
    expect(fn({ "a": 118, b: 6 })).toStrictEqual(6)
    expect(fn({ "a": 1 })).toStrictEqual(1)
    expect(() => fn([1])).toThrow('the function is not support array params')
    ToolFunc.unregister('test')
  })

  it('should register a func with position params', async () => {
    const params = [{ name: "a", type: "any" }, { name: "b", type: "any" }]
    ToolFunc.register({
      name: 'test',
      params,
      func: (a: any, b: any) => {
        return a > 15 ? b : a
      }
    })
    const result = ToolFunc.get('test')
    expect(result).toBeInstanceOf(ToolFunc)
    expect(result.name).toBe('test')
    expect(result.params).toStrictEqual(params)
    expect(result.func).toBeInstanceOf(Function)

    expect(result.runWithPosSync(1)).toStrictEqual(1)
    expect(await result.runWithPos(12)).toStrictEqual(12)
    expect(await result.runWithPos(118, 6)).toStrictEqual(6)

    expect(result.runSync({ "a": 1 })).toStrictEqual(1)
    expect(await result.run({ "a": 12 })).toStrictEqual(12)
    expect(await result.run({ "a": 118, b: 6 })).toStrictEqual(6)

    expect(result.runAsSync('test', { "a": 1, "b": 2 })).toStrictEqual(1)
    expect(await result.runAs('test', { "a": 118, b: 6 })).toStrictEqual(6)
    expect(await result.runWithPosAs('test', 118, 6)).toStrictEqual(6)

    let fn = result.getFuncWithPos()
    expect(fn(118, 6)).toStrictEqual(6)

    fn = result.getFunc()
    expect(fn({ "a": 118, b: 6 })).toStrictEqual(6)
    expect(fn({ "a": 1 })).toStrictEqual(1)
    expect(fn([1])).toStrictEqual(1)

    ToolFunc.unregister('test')
  })

  describe('Service Connection Pattern (connect)', () => {
    class OrderService extends ToolFunc { }

    it('should create separate classes with independent apiUrls', () => {
      const httpSrv = OrderService.connect('http://localhost/api');
      const mbxSrv = OrderService.connect('mailbox://peer-1/api');

      expect(httpSrv).not.toBe(mbxSrv);
      expect(httpSrv.apiUrl).toBe('http://localhost/api');
      expect(mbxSrv.apiUrl).toBe('mailbox://peer-1/api');
      expect(OrderService.apiUrl).toBeUndefined();
    });

    it('should isolate items registry between connections', () => {
      const srv1 = OrderService.connect('http://srv1');
      const srv2 = OrderService.connect('http://srv2');

      srv1.register({ name: 'tool1' });

      expect(srv1.get('tool1')).toBeDefined();
      expect(srv2.get('tool1')).toBeUndefined();
      expect(OrderService.get('tool1')).toBeUndefined();
    });

    it('should automatically inject apiUrl into tools during loadFromSync', () => {
      const apiUrl = 'http://dynamic-srv/v1';
      const srv = OrderService.connect(apiUrl);

      srv.loadFromSync({
        'myTool': { name: 'myTool', params: {} }
      } as any);

      const tool = srv.get('myTool');
      expect(tool).toBeDefined();
      expect(tool.apiUrl).toBe(apiUrl);
    });

    it('should support multi-level inheritance with connect', () => {
      class BaseSrv extends ToolFunc { }
      const subSrv = BaseSrv.connect('http://base');
      const leafSrv = subSrv.connect('http://leaf');

      expect(leafSrv.apiUrl).toBe('http://leaf');
      expect(subSrv.apiUrl).toBe('http://base');
    });

    it('should inherit fetchOptions from connect(url, options)', async () => {
      const apiUrl = 'http://options-srv';
      const srv = ToolFunc.connect(apiUrl, { timeout: 1234, custom: 'prop' });

      srv.loadFromSync({ 'testTool': { name: 'testTool' } } as any);
      const tool = srv.get('testTool') as any;

      // Mock getClient to check options
      const getClientSpy = vi.spyOn(RpcClientTransportManager.instance, 'getClient').mockImplementation((url, options) => {
        return { fetch: async () => options } as any;
      });

      const usedOptions = await tool.run();
      expect(usedOptions.timeout).toBe(1234);
      expect(usedOptions.custom).toBe('prop');

      getClientSpy.mockRestore();
    });

    it('should support dynamic binding via .with({ apiUrl })', async () => {
      // Mock getClient to observe called apiUrl
      const mockTransport = {
        fetch: async (name: string, params: any, act: string, sub: any, options: any) => options.apiUrl
      };
      const getClientSpy = vi.spyOn(RpcClientTransportManager.instance, 'getClient').mockImplementation(() => mockTransport as any);

      const tool = ToolFunc.register({ name: 'dynamicTool' }) as any;

      // Dynamic binding call
      const result = await tool.with({ apiUrl: 'http://dynamic-target' }).run();
      expect(result).toBe('http://dynamic-target');

      getClientSpy.mockRestore();
    });

    it('should pass all parameters correctly via fetch()', async () => {
      const apiUrl = 'http://fetch-params-test/api';
      const srv = ToolFunc.connect(apiUrl);

      // Mock transport to capture fetch call parameters
      const capturedCalls: any[] = [];
      const mockTransport = {
        fetch: async (name: string, args: any, act: string, subName: any, options: any, toolTimeout: any) => {
          capturedCalls.push({ name, args, act, subName, options, toolTimeout });
          return 'fetch-result';
        }
      };
      const getClientSpy = vi.spyOn(RpcClientTransportManager.instance, 'getClient').mockReturnValue(mockTransport as any);

      srv.loadFromSync({ 'fetchTest': { name: 'fetchTest', params: {}, timeout: 5000 } } as any);
      const tool = srv.get('fetchTest') as any;

      // Test 1: Basic fetch via run()
      const result1 = await tool.run({ msg: 'hello' });
      expect(result1).toBe('fetch-result');
      expect(capturedCalls.length).toBe(1);
      expect(capturedCalls[0].name).toBe('fetchTest');
      expect(capturedCalls[0].args).toEqual({ msg: 'hello' });
      expect(capturedCalls[0].toolTimeout).toBe(5000);

      // Test 2: Fetch with explicit action and subName
      capturedCalls.length = 0;
      const result2 = await tool.fetch({ id: '123' }, 'get', '456', { customOption: true });
      expect(result2).toBe('fetch-result');
      expect(capturedCalls.length).toBe(1);
      expect(capturedCalls[0].name).toBe('fetchTest');
      expect(capturedCalls[0].args).toEqual({ id: '123' });
      expect(capturedCalls[0].act).toBe('get');
      expect(capturedCalls[0].subName).toBe('456');

      getClientSpy.mockRestore();
    });

    it('should reuse cached transport for the same apiUrl', async () => {
      const apiUrl = 'http://cache-reuse-test/api';

      // Mock a minimal transport class for getClient to instantiate
      class MockCacheTransport {
        apiUrl: string;
        options?: any;
        constructor(url: string, options?: any) {
          this.apiUrl = url;
          this.options = options;
        }
        fetch = async () => 'cached-result'
      }

      // Register scheme so getClient can resolve and cache transports
      RpcClientTransportManager.bindScheme('http', MockCacheTransport)

      // First call: creates and caches a new transport
      const transport1 = RpcClientTransportManager.instance.getClient(apiUrl)
      expect(transport1).toBeInstanceOf(MockCacheTransport)
      expect(transport1.apiUrl).toBe(apiUrl)

      // Second call: should return the SAME cached instance
      const transport2 = RpcClientTransportManager.instance.getClient(apiUrl)
      expect(transport2).toBe(transport1)

      // Different URL should create a NEW transport
      const transport3 = RpcClientTransportManager.instance.getClient('http://cache-reuse-test/other')
      expect(transport3).toBeInstanceOf(MockCacheTransport)
      expect(transport3).not.toBe(transport1)

      // Clean up
      RpcClientTransportManager.clearSchemes()
    });

    it('should discover and register tools via loadFrom()', async () => {
      const apiUrl = 'http://discovery-test/api';
      const srv = ToolFunc.connect(apiUrl);

      // Mock transport with loadApis that returns tool definitions
      const mockTransport = {
        fetch: async () => 'mock',
        loadApis: vi.fn().mockResolvedValue({
          'discoveredTool': { name: 'discoveredTool', params: { x: { type: 'number' } }, timeout: 3000 },
          'anotherTool': { name: 'anotherTool', params: {} },
        } as any),
      };

      // Mock getClient to return our mock transport
      const getClientSpy = vi.spyOn(RpcClientTransportManager.instance, 'getClient').mockReturnValue(mockTransport as any);

      // Call loadFrom without items to trigger server discovery
      await srv.loadFrom(undefined, { apiUrl });

      // Verify loadApis was called
      expect(mockTransport.loadApis).toHaveBeenCalledTimes(1);

      // Verify tools were registered on the connected service
      const discoveredTool = srv.get('discoveredTool');
      expect(discoveredTool).toBeDefined();
      expect(discoveredTool).toBeInstanceOf(ToolFunc);
      expect(discoveredTool.apiUrl).toBe(apiUrl);

      const anotherTool = srv.get('anotherTool');
      expect(anotherTool).toBeDefined();
      expect(anotherTool.apiUrl).toBe(apiUrl);

      // Test that discovered tools can be called (via our mock)
      const result = await discoveredTool.run({ x: 42 });
      expect(result).toBe('mock');

      getClientSpy.mockRestore();
    });
  });
})
