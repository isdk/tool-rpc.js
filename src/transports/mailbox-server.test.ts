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

        expect(transport.dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            toolId: 'testTool',
            requestId: 'req-1'
        }), undefined);

        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            to: 'client@mbox',
            body: 'ok',
            headers: expect.objectContaining({
                [RPC_HEADERS.REQUEST_ID]: 'req-1'
            })
        }));
    });

    it('should handle discovery via headers (list/get)', async () => {
        const handler = vi.fn().mockReturnValue({ tools: [] });
        transport.addDiscoveryHandler(serverAddr, handler);

        const mockMsg = {
            from: 'client@mbox',
            headers: { [RPC_HEADERS.ACT]: 'list' }
        };

        await (transport as any).onReceive(mockMsg);
        
        expect(handler).toHaveBeenCalled();
        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            body: { tools: [] }
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
