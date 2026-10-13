import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerToolTransport } from './server';
import { HttpServerToolTransport } from './http-server';
import { RpcServerDispatcher } from './dispatcher';
import { ServerTools } from '../server-tools';
import { ToolFunc } from '@isdk/tool-func';
import { RpcTransportManager } from './server-manager';
import type { RouteEntry } from './server';
import type { ToolRpcRequest, ToolRpcResponse } from './models';
import { RPC_APIS_TOOL_ID } from './models';
import http from 'http';

/**
 * 最小可实例化的服务端 transport：只验路由表与注册表分层内核，不涉及物理协议。
 * （路由声明内核的测试在 `route-claims.test.ts`，这里只测新增的两件事：
 * 路由表把「前缀内路径」映射到工具 id，以及注册表按前缀分层解析。）
 */
class TableProbe extends ServerToolTransport {
  public addRpcHandler(apiUrl: string, options: any = {}): void {
    this.claimRoute(apiUrl, 'rpc', options);
  }

  public addDiscoveryHandler(apiUrl: string, handler: () => any, options: any = {}): void {
    this.claimRoute(apiUrl, 'discovery', { ...options, discoveryHandler: handler });
  }

  public tableOf(): Array<RouteEntry & { prefix: string }> {return this.getRouteTable();}

  public entryOf(prefix: string, input: { path: string; method?: string; act?: string }): RouteEntry | undefined {
    return this.matchRouteEntry(prefix, input);
  }

  /** 注册表分层的实际效果：给一个 toolId，本次请求会解析到哪个实例。 */
  public resolveFor(apiUrl: string, toolId: string): any {
    return this.requestRegistry({ apiUrl, toolId } as ToolRpcRequest).get(toolId);
  }

  public registryViewFor(apiUrl: string): any {
    return this.requestRegistry({ apiUrl } as ToolRpcRequest);
  }

  protected async toRpcRequest(): Promise<ToolRpcRequest> {return {} as ToolRpcRequest;}
  protected async sendRpcResponse(_rpcRes: ToolRpcResponse): Promise<void> {}
  public async _start(): Promise<any> {return undefined;}
  public async stop(): Promise<void> {}
}

const fakeReq = (url: string, method: string, headers: Record<string, any> = {}): http.IncomingMessage =>
   ({ url, method, headers: { host: 'localhost', ...headers } } as unknown as http.IncomingMessage);

const fakeRes = () => {
   const res: any = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0, headersSent: false };
   return res;
};

describe('ServerToolTransport route table', () => {
   let warn: any;
   beforeEach(() => {warn = vi.spyOn(console, 'warn').mockImplementation(() => {});});
   afterEach(() => {warn.mockRestore();});

   it('a claimed prefix comes with the built-in discovery rows (rpcApis)', () => {
      const t = new TableProbe();
      t.addRpcHandler('/api');

      const rows = t.tableOf().filter(row => row.prefix === '/api');
      expect(rows.map(row => row.toolId)).toEqual([RPC_APIS_TOOL_ID, RPC_APIS_TOOL_ID, RPC_APIS_TOOL_ID]);
      // HTTP 的 GET 根，与 Mailbox 的 act list / get，三种「怎么算发现请求」互不命中
      expect(rows.map(row => row.when)).toEqual([
         { method: 'GET' }, { act: 'list' }, { act: 'get' },
      ]);
   });

   it('matches the built-in row only under its own condition', () => {
      const t = new TableProbe();
      t.addRpcHandler('/api');

      expect(t.entryOf('/api', { path: '/', method: 'GET' })).toMatchObject({ toolId: RPC_APIS_TOOL_ID, act: 'list' });
      // Mailbox 没有 method，只有 act 那两行命中
      expect(t.entryOf('/api', { path: '/', act: 'list' })).toMatchObject({ act: 'list' });
      expect(t.entryOf('/api', { path: '/', act: 'get' })).toMatchObject({ act: 'get' });
      // POST 根不是发现请求；别的 act 也不是
      expect(t.entryOf('/api', { path: '/', method: 'POST' })).toBeUndefined();
      expect(t.entryOf('/api', { path: '/', act: 'run' })).toBeUndefined();
      expect(t.entryOf('/api', { path: '/other', method: 'GET' })).toBeUndefined();
   });

   it('treats "" and "/" as the same route (normalized before it becomes a key)', () => {
      const t = new TableProbe();
      t.addRpcHandler('/api');
      const before = t.tableOf().filter(row => row.prefix === '/api').length;

      // 第三方把「前缀根」声明到自己的工具上：写 '' 与 '/' 必须落在同一条
      t.addRoute('/api', { path: '', when: { method: 'GET' }, toolId: 'myRoot' });
      t.addRoute('/api', { path: '/', when: { method: 'GET' }, toolId: 'myRoot' });

      const rows = t.tableOf().filter(row => row.prefix === '/api');
      expect(rows.length).toBe(before);
      expect(rows.find(row => row.when?.method === 'GET')).toMatchObject({ path: '/', toolId: 'myRoot' });
      expect(t.entryOf('/api', { path: '/', method: 'GET' })).toMatchObject({ toolId: 'myRoot' });
   });

   it('normalizes a lower-case when.method declaration (issue #7)', () => {
      const t = new TableProbe();
      t.addRpcHandler('/api');

      // Node 的 `rawReq.method` 永远大写，声明写小写也必须能命中
      t.addRoute('/api', { path: '/legacy', when: { method: 'get' }, toolId: 'lowerCase' });

      expect(t.tableOf().find(row => row.path === '/legacy')?.when).toEqual({ method: 'GET' });
      expect(t.entryOf('/api', { path: '/legacy', method: 'GET' })).toMatchObject({ toolId: 'lowerCase' });

      // 归一后才谈得上「同一条声明」：小写声明要能替换内置行，而不是多出一条永不命中的行
      t.addRoute('/api', { path: '/', when: { method: 'get' }, toolId: 'myRoot' });
      expect(t.entryOf('/api', { path: '/', method: 'GET' })).toMatchObject({ toolId: 'myRoot' });
      expect(t.tableOf().filter(row => row.prefix === '/api' && row.path === '/' && row.when?.method).length).toBe(1);
   });

   it('a third-party row replaces the built-in one, and other rows coexist', () => {
      const t = new TableProbe();
      t.addRpcHandler('/api');

      t.addRoute('/api', { path: '/', when: { method: 'GET' }, toolId: 'myRoot' });
      t.addRoute('/api', { path: '/legacy', when: { method: 'GET' }, toolId: 'newTool', act: 'run' });

      expect(t.entryOf('/api', { path: '/', method: 'GET' })).toMatchObject({ toolId: 'myRoot' });
      expect(t.entryOf('/api', { path: '/legacy', method: 'GET' })).toMatchObject({ toolId: 'newTool', act: 'run' });
      // act 那两行还在：Mailbox 式的发现请求不受 HTTP 行覆盖的影响
      expect(t.entryOf('/api', { path: '/', act: 'list' })).toMatchObject({ toolId: RPC_APIS_TOOL_ID });
   });

   it('normalizes the declared path the same way as a request path', () => {
      const t = new TableProbe();
      t.addRpcHandler('/api');
      t.addRoute('/api', { path: '/a//b/', when: { method: 'GET' }, toolId: 'deep' });

      expect(t.entryOf('/api', { path: '/a/b', method: 'GET' })).toMatchObject({ toolId: 'deep' });
      expect(t.tableOf().find(row => row.toolId === 'deep')!.path).toBe('/a/b');
   });

   it('addRoute on an unclaimed prefix does not consume the rpc/discovery claim', () => {
      const t = new TableProbe();
      t.addRoute('/v1', { path: '/health', when: { method: 'GET' }, toolId: 'health' });
      // 之后正常声明 rpc 路由：不该被当成重复声明（否则 addRoute 就成了抢路由的通道）
      t.addRpcHandler('/v1');
      expect(t.tableOf().find(row => row.toolId === 'health')).toBeDefined();
      expect(warn).not.toHaveBeenCalled();
   });

   it('resolves the registry per prefix, so two prefixes keep their own tool sets', () => {
      const t = new TableProbe();
      const regA = { alpha: { name: 'alpha' } };
      const regB = { beta: { name: 'beta' } };
      t.addRpcHandler('/a', { registry: regA });
      t.addRpcHandler('/b', { registry: regB });

      expect(t.resolveFor('http://h:1/a/x', 'alpha')).toMatchObject({ name: 'alpha' });
      expect(t.resolveFor('http://h:1/a/x', 'beta')).toBeUndefined();
      expect(t.resolveFor('http://h:1/b/x', 'beta')).toMatchObject({ name: 'beta' });
      expect(t.resolveFor('http://h:1/b/x', 'alpha')).toBeUndefined();
   });

   it('the registry view exposes toJSON of the matched prefix (what rpcApis lists)', () => {
      const t = new TableProbe();
      t.addRpcHandler('/a', { registry: { toJSON: () => ({ only: 'a' }) } });
      t.addRpcHandler('/b', { registry: { toJSON: () => ({ only: 'b' }) } });

      expect(t.registryViewFor('/a').toJSON()).toEqual({ only: 'a' });
      expect(t.registryViewFor('/b').toJSON()).toEqual({ only: 'b' });
   });

   it('the view enumerates a layer that has no toJSON() (issue #1)', () => {
      // 以前视图在没有任何一层会 `toJSON` 时回 `undefined`，`rpcApis` 照单全收，
      // 于是下面三种形态在 transport 后面只能得到空清单。
      const t = new TableProbe();

      // ToolFunc 家族：只有静态 `items`
      class MyToolFuncTools extends ToolFunc {}
      MyToolFuncTools.items = {} as any;
      new (MyToolFuncTools as any)('alpha', { params: {}, func: () => 'a', isApi: true }).register();
      t.addRpcHandler('/f', { registry: MyToolFuncTools });
      expect(Object.keys(t.registryViewFor('/f').toJSON())).toContain('alpha');

      // Map 形状：只有 `get` / `entries`
      const map = new Map<string, any>([['one', { name: 'one' }], ['two', { name: 'two' }]]);
      t.addRpcHandler('/m', { registry: { get: (id: string) => map.get(id), entries: () => map.entries() } });
      expect(t.registryViewFor('/m').toJSON()).toMatchObject({ one: { name: 'one' }, two: { name: 'two' } });

      // 普通对象映射
      t.addRpcHandler('/o', { registry: { gamma: { name: 'gamma' } } });
      expect(t.registryViewFor('/o').toJSON()).toMatchObject({ gamma: { name: 'gamma' } });
   });

   it('the view merges every layer, so anything get() resolves is listed', () => {
      // 只取第一个会 `toJSON` 的层，另一层的工具就从清单里消失了——可 `get()` 能解析到它，
      // 它也真能被调用。清单与寻址必须同一套分层。
      const t = new TableProbe({
         dispatcher: new RpcServerDispatcher({ registry: { toJSON: () => ({ fromDispatcher: { name: 'fromDispatcher' } }) } }),
      });
      t.addRpcHandler('/a', { registry: { toJSON: () => ({ fromPrefix: { name: 'fromPrefix' } }) } });

      expect(t.registryViewFor('/a').toJSON()).toEqual({
         fromPrefix: { name: 'fromPrefix' },
         fromDispatcher: { name: 'fromDispatcher' },
      });
   });

   it('a name claimed by an earlier layer is listed as that layer\'s tool', () => {
      // 与 `get()` 同一套优先级：清单里那个条目就是真会被调的那个。
      const t = new TableProbe({
         dispatcher: new RpcServerDispatcher({
            registry: {
               get: (id: string) => (id === 'shared' ? { name: 'shared', from: 'dispatcher' } : undefined),
               toJSON: () => ({ shared: { name: 'shared', from: 'dispatcher' } }),
            },
         }),
      });
      t.addRpcHandler('/a', {
         registry: {
            get: (id: string) => (id === 'shared' ? { name: 'shared', from: 'prefix' } : undefined),
            toJSON: () => ({ shared: { name: 'shared', from: 'prefix' } }),
         },
      });

      expect(t.registryViewFor('/a').toJSON().shared).toEqual({ name: 'shared', from: 'prefix' });
      expect(t.resolveFor('/a/shared', 'shared')).toMatchObject({ from: 'prefix' });
   });

   it('a custom discoveryHandler is that prefix\'s rpcApis implementation', async () => {
      const t = new TableProbe();
      t.addRpcHandler('/a');
      t.addDiscoveryHandler('/a', () => ({ listed: 'a' }));

      const tool = t.resolveFor('/a/x', RPC_APIS_TOOL_ID);
      expect(tool).toBeDefined();
      expect(tool.timeout).toBe(0);
      expect(await tool.run()).toEqual({ listed: 'a' });
   });

   it('a handler returning something with toJSON() gets it called (mailbox parity)', async () => {
      const t = new TableProbe();
      t.addRpcHandler('/a');
      t.addDiscoveryHandler('/a', () => ({ toJSON: () => ({ listed: 'via-toJSON' }) }));

      expect(await t.resolveFor('/a/x', RPC_APIS_TOOL_ID).run()).toEqual({ listed: 'via-toJSON' });
   });

   it('a business registry entry with the reserved id overrides the built-in tool', () => {
      const t = new TableProbe();
      t.addRpcHandler('/a', { registry: { [RPC_APIS_TOOL_ID]: { name: 'mine' } } });

      expect(t.resolveFor('/a/x', RPC_APIS_TOOL_ID)).toMatchObject({ name: 'mine' });
   });
});

describe('built-in rpcApis tool through the dispatcher', () => {
   afterEach(() => {
      ToolFunc.items = {};
      ServerTools.items = {};
   });

   const request = (over: Partial<ToolRpcRequest> = {}): ToolRpcRequest => ({
      apiUrl: 'http://h:1/api',
      toolId: RPC_APIS_TOOL_ID,
      act: 'list',
      requestId: 'req-1',
      params: {},
      headers: {},
      ...over,
   } as ToolRpcRequest);

   it('lists the registry resolved for this request', async () => {
      class MyTools extends ServerTools {}
      MyTools.defineProperties(MyTools, { name: { type: 'string' } } as any);
      new (MyTools as any)('alpha', { params: {}, func: () => 'a', isApi: true }).register();

      const dispatcher = new RpcServerDispatcher({ registry: MyTools });
      const res = await dispatcher.dispatch(request());

      expect(res.status).toBe(200);
      expect(Object.keys(res.data!)).toContain('alpha');
   });

   it('falls back to the dispatcher registry when the transport passes none', async () => {
      const dispatcher = new RpcServerDispatcher({ registry: { toJSON: () => ({ flat: true }) } });
      const res = await dispatcher.dispatch(request());
      expect(res.data).toEqual({ flat: true });
   });

   it('enumerates a Map-shaped registry that has no toJSON()', async () => {
      const registry = new Map<string, any>([
         ['one', { name: 'one', toJSON: () => ({ name: 'one' }) }],
         ['two', { name: 'two' }],
      ]);
      const dispatcher = new RpcServerDispatcher({ registry: { get: (id: string) => registry.get(id), entries: () => registry.entries() } });
      const res = await dispatcher.dispatch(request());
      expect(res.data).toEqual({ one: { name: 'one' }, two: { name: 'two' } });
   });

   it('act "get" with a resId returns one entry, unknown resId is 404', async () => {
      const dispatcher = new RpcServerDispatcher({
         registry: {
            get: (id: string) => (id === 'known' ? { toJSON: () => ({ name: 'known' }) } : undefined),
            toJSON: () => ({ known: { name: 'known' } }),
         },
      });

      expect((await dispatcher.dispatch(request({ act: 'get', resId: 'known' }))).data).toEqual({ name: 'known' });

      const missing = await dispatcher.dispatch(request({ act: 'get', resId: 'nope' }));
      expect(missing.status).toBe(404);
      expect(missing.error?.code).toBe(404);
   });

   it('a manifest entry carries no function body unless the tool opts in (issue #2)', async () => {
      // `ToolFunc.toJSON()` 把 `func` 序列成源码字符串（那是 `allowExportFunc` 的本地执行通道），
      // 所以「照工具自己的 `toJSON()` 回」等于把实现源码发到发现端点。
      // 规则与 `ServerTools.toJSON()` 对齐：默认剥掉，`allowExportFunc: true` 才导出。
      class PlainTools extends ToolFunc {}
      PlainTools.items = {} as any;
      new (PlainTools as any)('plain', { params: {}, func: () => 'plain', isApi: true }).register();

      const listed = await new RpcServerDispatcher({ registry: PlainTools }).dispatch(request());
      expect(listed.data!.plain).toMatchObject({ name: 'plain', isApi: true });
      expect(listed.data!.plain.func).toBeUndefined();

      // `act: 'get'` 的单条走同一条规则（以前它直接回 `tool.toJSON()`，函数体照送）
      const single = await new RpcServerDispatcher({ registry: PlainTools }).dispatch(request({ act: 'get', resId: 'plain' }));
      expect(single.data).toMatchObject({ name: 'plain' });
      expect(single.data.func).toBeUndefined();

      // 显式导出仍然带函数体
      class ExportedTools extends ServerTools {}
      ExportedTools.items = {} as any;
      new (ExportedTools as any)('exported', { params: {}, func: () => 'exported', isApi: true, allowExportFunc: true }).register();

      const optedIn = await new RpcServerDispatcher({ registry: ExportedTools }).dispatch(request({ act: 'get', resId: 'exported' }));
      expect(typeof optedIn.data.func).toBe('string');

      // 同一个工具没开导出，就是另一回事
      class PrivateTools extends ServerTools {}
      PrivateTools.items = {} as any;
      new (PrivateTools as any)('private', { params: {}, func: () => 'private', isApi: true }).register();

      const optedOut = await new RpcServerDispatcher({ registry: PrivateTools }).dispatch(request({ act: 'get', resId: 'private' }));
      expect(optedOut.data.func).toBeUndefined();
   });

   it('is registered as a system tool with timeout 0 (not exempt, not timed out by the default)', () => {
      const dispatcher = new RpcServerDispatcher();
      expect(dispatcher.getSystemTool(RPC_APIS_TOOL_ID)).toBeDefined();
      expect(dispatcher.getSystemTool(RPC_APIS_TOOL_ID).timeout).toBe(0);
   });

   it('a slow discovery handler is still cut off by globalTimeout', async () => {
      // 以前发现端点不经 dispatcher，globalTimeout 对它无效。现在它就是一个工具调用，
      // 所以同一个死线控制器也管得到它（`timeout: 0` 只意味着不自己定一个，不是豁免）。
      const dispatcher = new RpcServerDispatcher({
         globalTimeout: 50,
         terminationGraceMs: 10,
         registry: { toJSON: async () => {await new Promise(r => setTimeout(r, 2000));return {}; } },
      });

      const res = await dispatcher.dispatch(request());
      expect(res.status).toBe(504);
   });
});

describe('HTTP addressing goes through the route table', () => {
   let transport: HttpServerToolTransport;
   let dispatcher: RpcServerDispatcher;
   let dispatched: Array<{ req: ToolRpcRequest; registry: any }>;

   beforeEach(() => {
      dispatcher = new RpcServerDispatcher();
      dispatcher.dispatch = vi.fn(async (req: ToolRpcRequest, registry: any) => {
         dispatched.push({ req, registry });
         return { status: 200, data: 'ok' };
      }) as any;

      transport = new HttpServerToolTransport({ dispatcher });
      transport.addRpcHandler('http://localhost/api');
      dispatched = [];
   });

   afterEach(() => {
      vi.restoreAllMocks();
      (HttpServerToolTransport as any).sharedServers.clear();
   });

   const hit = async (url: string, method: string, headers?: Record<string, any>) => {
      await (transport as any).handleInternalRequest(fakeReq(url, method, headers), fakeRes());
      return dispatched[0];
   };

   it('GET on the prefix root addresses the built-in tool', async () => {
      expect((await hit('/api', 'GET'))!.req).toMatchObject({ toolId: RPC_APIS_TOOL_ID, act: 'list' });
      // 尾斜杠与不带尾斜杠是同一条（默认 strictTrailingSlash: false）
      expect((await hit('/api/', 'GET'))!.req).toMatchObject({ toolId: RPC_APIS_TOOL_ID, act: 'list' });
   });

   it('GET on the reserved tool path addresses it too, with no extra declaration', async () => {
      expect((await hit('/api/rpcApis', 'GET'))!.req).toMatchObject({ toolId: RPC_APIS_TOOL_ID });
   });

   it('POST on the root is not a discovery request', async () => {
      const res = fakeRes();
      await (transport as any).handleInternalRequest(fakeReq('/api', 'POST'), res);
      expect(dispatched).toHaveLength(0);
      expect(res.statusCode).toBe(400);
   });

   it('an explicit rpc-fn header outranks the route table', async () => {
      const found = await hit('/api', 'GET', { 'rpc-fn': 'explicit' });
      expect(found!.req.toolId).toBe('explicit');
   });

   it('a third-party addRoute is honored, and getRouteTable reports it', async () => {
      transport.addRoute('http://localhost/api', { path: '/legacy', when: { method: 'GET' }, toolId: 'newTool', act: 'run' });

      expect((await hit('/api/legacy', 'GET'))!.req).toMatchObject({ toolId: 'newTool', act: 'run' });

      const declared = transport.getRouteTable().filter(row => row.prefix === '/api');
      expect(declared.map(row => row.path)).toContain('/legacy');
   });

   it('the discovery request reaches validateRpcRequest with the built-in tool id', async () => {
      const manager: any = RpcTransportManager.instance;
      const spy = vi.spyOn(manager, 'validateRpcRequest').mockImplementation(() => {});

      await (transport as any).handleInternalRequest(fakeReq('/api', 'GET'), fakeRes());

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ toolId: RPC_APIS_TOOL_ID });
      spy.mockRestore();
   });

   it('discovery lists the matched prefix\'s registry, not the dispatcher-wide one', async () => {
      // 这个用例要跑真 dispatcher（上面那个 beforeEach 把它 mock 了），因为要验的是清单内容
      const scoped = new HttpServerToolTransport({ dispatcher: new RpcServerDispatcher() });
      scoped.addRpcHandler('http://localhost/api', { registry: { toJSON: () => ({ scoped: true }) } });

      const res = fakeRes();
      await (scoped as any).handleInternalRequest(fakeReq('/api', 'GET'), res);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ scoped: true });
   });

   it('a custom discoveryHandler wins over the registry listing for that prefix', async () => {
      const scoped = new HttpServerToolTransport({ dispatcher: new RpcServerDispatcher() });
      scoped.addRpcHandler('http://localhost/api', { registry: { toJSON: () => ({ scoped: true }) } });
      scoped.addDiscoveryHandler('http://localhost/api', () => ({ listed: true }));

      const res = fakeRes();
      await (scoped as any).handleInternalRequest(fakeReq('/api', 'GET'), res);

      expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ listed: true });
   });
});

describe('addDiscoveryHandler 迁移提示', () => {
   // 提示是进程级只打一次（static flag），所以每个用例都要 resetModules 重新加载模块，
   // 否则会被同文件其它用例先触发过。
   const hintCalls = (warn: any) =>
      warn.mock.calls.filter((c: any[]) => String(c[0]).includes('addDiscoveryHandler() is deprecated'));

   it('HTTP：首次声明打一次，后续重复声明不再刷', async () => {
      vi.resetModules();
      const mod = await import('./http-server');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
         const a = new mod.HttpServerToolTransport({ apiUrl: '/dep-a' });
         a.addDiscoveryHandler('/dep-a', () => ({}));
         const b = new mod.HttpServerToolTransport({ apiUrl: '/dep-b' });
         b.addDiscoveryHandler('/dep-b', () => ({}));
         b.addDiscoveryHandler('/dep-b', () => ({}));
         expect(hintCalls(warn).length).toBe(1);
      } finally {
         warn.mockRestore();
      }
   });

   it('Mailbox：同样打提示（fresh 模块，不被 HTTP 侧那次吃掉）', async () => {
      vi.resetModules();
      const { Mailbox } = await import('@mboxlabs/mailbox');
      const mod = await import('./mailbox-server');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
         const t = new mod.MailboxServerTransport({ mailbox: new Mailbox(), apiUrl: 'mem://dep@mailbox/api' });
         t.addDiscoveryHandler('mem://dep@mailbox/api', () => ({}));
         expect(hintCalls(warn).length).toBe(1);
      } finally {
         warn.mockRestore();
      }
   });

   it('不用它的用户不会收到提示（addRpcHandler 不打）', async () => {
      vi.resetModules();
      const mod = await import('./http-server');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
         const t = new mod.HttpServerToolTransport({ apiUrl: '/quiet' });
         t.addRpcHandler('/quiet');
         expect(hintCalls(warn).length).toBe(0);
      } finally {
         warn.mockRestore();
      }
   });
});
