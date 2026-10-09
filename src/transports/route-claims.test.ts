import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerToolTransport } from './server';
import { HttpServerToolTransport } from './http-server';
import { MailboxServerTransport } from './mailbox-server';
import type { ToolRpcRequest, ToolRpcResponse } from './models';

/**
 * 最小可实例化的服务端 transport：只用来验证 ServerToolTransport 的
 * 路由声明内核（归一化 / 多前缀 claim / remount），不涉及任何物理协议。
 */
class ClaimProbe extends ServerToolTransport {
  /** 记录“物理路由注册”是否发生，用于断言重复声明不再重复注册。 */
  public registered: string[] = [];
  public duplicateHook = vi.fn();

  public addRpcHandler(apiUrl: string, options: any = {}): void {
    const claim = this.claimRoute(apiUrl, 'rpc', options);
    if (!claim) {return;}
    this.registered.push(`ALL ${claim.prefix}`);
  }

  public addDiscoveryHandler(apiUrl: string, handler: () => any, options: any = {}): void {
    const claim = this.claimRoute(apiUrl, 'discovery', { ...options, discoveryHandler: handler });
    if (!claim) {return;}
    this.registered.push(`GET ${claim.prefix}`);
  }

  protected onDuplicateRoute(prefix: string, kind: 'rpc' | 'discovery'): never {
    this.duplicateHook(prefix, kind);
    return super.onDuplicateRoute(prefix, kind);
  }

  // 暴露 protected 内核，便于直接断言
  public pathOf(apiUrl: string): string {return this.toPathname(apiUrl);}
  public matchOf(prefix: string): string {return this.toMatchPrefix(prefix);}
  public registryOf(prefix: string): any {return this.routeRegistry(prefix);}
  public handlerOf(prefix: string): (() => any) | undefined {return this.routeDiscoveryHandler(prefix);}
  public urlOf(prefix: string): string | undefined {return this.routeApiUrl(prefix);}

  protected async toRpcRequest(): Promise<ToolRpcRequest> {return {} as ToolRpcRequest;}
  protected async sendRpcResponse(_rpcRes: ToolRpcResponse): Promise<void> {}
  public async _start(): Promise<any> {return undefined;}
  public async stop(): Promise<void> {}
}

describe('ServerToolTransport route claims', () => {
  let warn: any;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('normalizes apiUrl and path prefixes to a canonical prefix', () => {
    const t = new ClaimProbe();
    expect(t.pathOf('http://localhost:3000/api/')).toBe('/api');
    expect(t.pathOf('https://h/a//b//')).toBe('/a/b');
    expect(t.pathOf('/api')).toBe('/api');
    expect(t.pathOf('api/x')).toBe('/api/x');
    // 空路径与根路径都归一为 '/'，路由表普遍拒绝空 path
    expect(t.pathOf('')).toBe('/');
    expect(t.pathOf('/')).toBe('/');
    expect(t.pathOf('http://localhost:3000')).toBe('/');
  });

  it('keeps a separate match form so /api cannot match /apix', () => {
    const t = new ClaimProbe();
    expect(t.matchOf('/')).toBe('/');
    expect(t.matchOf('/api')).toBe('/api/');
    expect('/apix/'.startsWith(t.matchOf('/api'))).toBe(false);
  });

  it('reports one logical route per prefix, not one per physical route', () => {
    const t = new ClaimProbe();
    expect(t.getRoutes()).toEqual(['/']);

    t.addRpcHandler('http://h:1/api');
    t.addDiscoveryHandler('http://h:1/api', () => ({}));
    expect(t.getRoutes()).toEqual(['/api']);

    t.addRpcHandler('/v2');
    expect(t.getRoutes().sort()).toEqual(['/api', '/v2']);
  });

  it('binds registry and discovery handler per prefix, resolved at request time', () => {
    const t = new ClaimProbe();
    const regA = { name: 'A' };
    const regB = { name: 'B' };
    t.addRpcHandler('/a', { registry: regA });
    t.addRpcHandler('/b', { registry: regB });
    t.addDiscoveryHandler('/a', () => 'discovery-a');
    t.addDiscoveryHandler('/b', () => 'discovery-b');

    expect(t.registryOf('/a')).toBe(regA);
    expect(t.registryOf('/b')).toBe(regB);
    expect(t.handlerOf('/a')!()).toBe('discovery-a');
    expect(t.handlerOf('/b')!()).toBe('discovery-b');
    expect(t.urlOf('/b')).toBe('/b');
  });

  it('replaces the registry/handler on a repeated claim without re-registering', () => {
    const t = new ClaimProbe();
    const regA = { name: 'A' };
    const regB = { name: 'B' };

    t.addRpcHandler('/dup', { registry: regA });
    t.addDiscoveryHandler('/dup', () => 'first');
    expect(t.registered).toEqual(['ALL /dup', 'GET /dup']);

    t.addRpcHandler('/dup', { registry: regB });
    t.addDiscoveryHandler('/dup', () => 'second');
    // 物理路由没有再次注册（否则框架会抛重复路由错误）
    expect(t.registered).toEqual(['ALL /dup', 'GET /dup']);
    expect(t.registryOf('/dup')).toBe(regB);
    expect(t.handlerOf('/dup')!()).toBe('second');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('throws through onDuplicateRoute when remount is "throw"', () => {
    const t = new ClaimProbe();
    t.addRpcHandler('/strict', { registry: { name: 'A' } });
    t.addDiscoveryHandler('/strict', () => 'first');

    expect(() => t.addRpcHandler('/strict', { registry: { name: 'B' }, remount: 'throw' }))
      .toThrow(/Route already claimed: rpc route for "\/strict"/);
    expect(t.duplicateHook).toHaveBeenCalledWith('/strict', 'rpc');
    expect(() => t.addDiscoveryHandler('/strict', () => 'second', { remount: 'throw' }))
      .toThrow(/Route already claimed: discovery route for "\/strict"/);

    // 被拒的声明不得改动已有逻辑信息
    expect(t.registryOf('/strict')!.name).toBe('A');
    expect(t.handlerOf('/strict')!()).toBe('first');
    expect(t.registered).toEqual(['ALL /strict', 'GET /strict']);
  });

  it('treats rpc and discovery as separate claims on the same prefix', () => {
    const t = new ClaimProbe();
    // 先声明发现路由，再声明 RPC：两者都应注册物理路由
    t.addDiscoveryHandler('/mixed', () => ({}));
    expect(() => t.addRpcHandler('/mixed', { remount: 'throw' })).not.toThrow();
    expect(t.registered).toEqual(['GET /mixed', 'ALL /mixed']);
    expect(t.duplicateHook).not.toHaveBeenCalled();
  });
});

/**
 * 内置 transport 不重写 remount 判断，只决定冲突如何上报；
 * 这里验证它们确实从基类继承了同一套语义。
 */
describe('remount semantics on the built-in server transports', () => {
   let warn: any;

   beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
   });

   afterEach(() => {
      warn.mockRestore();
   });

   it('HttpServerToolTransport replaces by default and throws on remount: throw', () => {
      const t = new HttpServerToolTransport({ apiUrl: 'http://localhost:3009/api' });
      const regA = { name: 'A' } as any;
      const regB = { name: 'B' } as any;

      t.addRpcHandler('http://localhost:3009/api', { registry: regA });
      t.addDiscoveryHandler('http://localhost:3009/api', () => 'first');
      expect(t.getRoutes()).toEqual(['/api']);

      expect(() => t.addRpcHandler('http://localhost:3009/api', { registry: regB })).not.toThrow();
      expect((t as any).routeRegistry('/api')).toBe(regB);
      expect(warn).toHaveBeenCalledTimes(1);

      expect(() => t.addDiscoveryHandler('http://localhost:3009/api', () => 'second', { remount: 'throw' }))
         .toThrow(/Route already claimed: discovery route for "\/api"/);
      expect((t as any).routeDiscoveryHandler('/api')!()).toBe('first');
   });

   it('MailboxServerTransport keeps its exclusive route but honors remount', () => {
      const t = new MailboxServerTransport({ apiUrl: 'mailbox://srv-claims/' });

      t.addRpcHandler('mailbox://srv-claims/api');
      // 独占保护：mailbox 地址只允许一个服务端实例，逻辑路由仍是 '/'
      expect(t.getRoutes()).toEqual(['/']);

      expect(() => t.addRpcHandler('mailbox://srv-claims/api', { remount: 'throw' }))
         .toThrow(/Route already claimed: rpc route for "\/api"/);
   });
});
