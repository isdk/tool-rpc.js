import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailboxServerTransport } from './mailbox-server';
import { Mailbox } from '@mboxlabs/mailbox';
import { RPC_HEADERS, RpcStatusCode } from './models';

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

    it('should extract path from apiUrl correctly', () => {
        expect((transport as any).apiPrefix).toBe('/api/v1/');
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
});
