import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailboxServerTransport } from './mailbox-server';
import { Mailbox } from '@mboxlabs/mailbox';
import { RPC_HEADERS } from './models';
import { RpcTransportManager } from './server-manager';

describe('MailboxServerTransport Unit', () => {
    let mailbox: Mailbox;
    let transport: MailboxServerTransport;
    const serverAddr = 'mem://bot@mailbox/api/v1';

    beforeEach(() => {
        mailbox = new Mailbox();
        mailbox.post = vi.fn().mockResolvedValue(undefined);
        mailbox.subscribe = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });
        mailbox.start = vi.fn().mockResolvedValue(undefined);
        mailbox.stop = vi.fn().mockResolvedValue(undefined);
        mailbox.fetch = vi.fn().mockResolvedValue(null);

        transport = new MailboxServerTransport({ mailbox, apiUrl: serverAddr });
        transport.dispatcher.dispatch = vi.fn().mockResolvedValue({ status: 200, data: 'ok' });
    });

    it('should derive the route prefix from apiUrl with the shared route-path rule', () => {
        // 不再自带一套 extractPath：与基类 / 请求侧同一份 normalizeRoutePath
        expect((transport as any).toPathname(serverAddr)).toBe('/api/v1');
        expect((transport as any).toPathname('/api/v1')).toBe('/api/v1');
    });

    it('should process incoming call and send response via mailbox.post', async () => {
        const mockMsg = {
            id: 'msg-1',
            from: 'client@mbox',
            to: serverAddr,
            body: { a: 1 },
            headers: {
                [RPC_HEADERS.TOOL_ID]: 'testTool',
                [RPC_HEADERS.REQUEST_ID]: 'req-1'
            }
        };

        await (transport as any).onReceive(mockMsg);

        // 第二个参数不再是 undefined：它是本次请求的注册表视图（按前缀分层）。
        // 以前 dispatcher 只能看到全局那一个 registry，多前缀时会串。
        const dispatchCall = (transport.dispatcher.dispatch as any).mock.calls[0];
        expect(dispatchCall[0]).toMatchObject({ toolId: 'testTool', requestId: 'req-1' });
        expect(typeof dispatchCall[1].get).toBe('function');

        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            to: 'client@mbox',
            body: 'ok',
            headers: expect.objectContaining({
                [RPC_HEADERS.REQUEST_ID]: 'req-1'
            })
        }));
    });

    it('routes a discovery message (no toolId + act list) to the built-in rpcApis tool', async () => {
        const handler = vi.fn().mockReturnValue({ tools: [] });
        transport.addDiscoveryHandler(serverAddr, handler);

        const mockMsg = {
            from: 'client@mbox',
            headers: { [RPC_HEADERS.ACT]: 'list', [RPC_HEADERS.REQUEST_ID]: 'req-2' }
        };

        await (transport as any).onReceive(mockMsg);

        // 不再是 transport 里的分叉：它只是一个寻址结果，所以同一条管道都管得到它
        const dispatchCall = (transport.dispatcher.dispatch as any).mock.calls[0];
        expect(dispatchCall[0]).toMatchObject({ toolId: 'rpcApis', act: 'list' });

        // 该前缀声明过自定义清单处理器 → 它就是 rpcApis 的实现
        const tool = dispatchCall[1].get('rpcApis');
        expect(await tool.run()).toEqual({ tools: [] });
        expect(handler).toHaveBeenCalled();
    });

    it('rejects a message with neither toolId nor a discovery act (400, not silently discovery)', async () => {
        transport.addRpcHandler(serverAddr);

        await (transport as any).onReceive({
            from: 'client@mbox',
            headers: { [RPC_HEADERS.ACT]: 'run', [RPC_HEADERS.REQUEST_ID]: 'req-3' }
        });

        expect(transport.dispatcher.dispatch).not.toHaveBeenCalled();
        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            body: expect.objectContaining({
                error: expect.objectContaining({ code: 400 })
            })
        }));
    });

    it('should handle 102 processing state in mailbox', async () => {
        transport.dispatcher.dispatch = vi.fn().mockResolvedValue({ 
            status: 102, 
            data: { status: 102, message: 'working' },
            headers: { 'rpc-retry-after': 500 }
        });

        const mockMsg = {
            from: 'client@mbox',
            headers: { [RPC_HEADERS.TOOL_ID]: 'long', [RPC_HEADERS.REQUEST_ID]: 'r1' }
        };

        await (transport as any).onReceive(mockMsg);

        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            body: expect.objectContaining({ status: 102, message: 'working' })
        }));
    });

    it('should throw 400 if rpc-fn is missing', async () => {
        const mockMsg = { from: 'client@mbox', headers: { [RPC_HEADERS.REQUEST_ID]: 'no-fn' } };
        
        await (transport as any).onReceive(mockMsg);
        
        // Response should contain the error
        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            body: expect.objectContaining({
                error: expect.objectContaining({ code: 400 })
            })
        }));
    });

    it('should support mbx-reply-to override', async () => {
        const mockMsg = {
            from: 'client@mbox',
            headers: { 
                [RPC_HEADERS.TOOL_ID]: 't1', 
                [RPC_HEADERS.REQUEST_ID]: 'r1',
                'mbx-reply-to': 'other@mbox' 
            }
        };

        await (transport as any).onReceive(mockMsg);

        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            to: 'other@mbox'
        }));
    });

    it('should call stop on internal mailbox if created by transport', async () => {
        const transportInternal = new MailboxServerTransport({ apiUrl: serverAddr });
        const mailboxInternal = (transportInternal as any).mailbox;
        mailboxInternal.stop = vi.fn();
        
        await transportInternal.stop();
        expect(mailboxInternal.stop).toHaveBeenCalled();
    });

    it('should release the audited routes on stop (same contract as HTTP stop)', async () => {
        // 旧实现 stop() 不调 unregisterRoutes()：这个地址上的路由永久占位，
        // 下一个实例 registerServer 必报 Routing Conflict（实测）
        const manager = new RpcTransportManager();
        const first = new MailboxServerTransport({ mailbox, apiUrl: serverAddr });
        manager.registerServer(first);
        await first.start();
        await first.stop();

        const second = new MailboxServerTransport({ mailbox, apiUrl: serverAddr });
        expect(() => manager.registerServer(second)).not.toThrow();
    });

    it('should keep distinct bare-path prefixes apart', () => {
        // 旧实现的 extractPath 把解析不了的 apiUrl 一律退成 '/'，于是 '/y' 与 '/z'
        // 塌成同一条 claim，第二条被当成重复声明（实测会 warn / remount:'throw' 时报错）
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            transport.addRpcHandler('/y');
            transport.addRpcHandler('/z');
            const warned = warn.mock.calls.map(c => String(c[0])).join('');
            expect(warned).not.toMatch(/already claimed/);
            expect([...(transport as any).routeClaims.keys()].sort()).toEqual(['/y', '/z']);
        } finally {
            warn.mockRestore();
        }
    });
});
