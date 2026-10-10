import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MailboxClientTransport } from './mailbox-client';
import { Mailbox } from '@mboxlabs/mailbox';
import { RPC_HEADERS } from './models';

describe('MailboxClientTransport', () => {
    let mailbox: Mailbox;
    let transport: MailboxClientTransport;

    beforeEach(() => {
        mailbox = new Mailbox();
        // Mock mailbox methods
        mailbox.start = vi.fn().mockResolvedValue(undefined);
        mailbox.subscribe = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });
        mailbox.post = vi.fn().mockResolvedValue(undefined);
        
        transport = new MailboxClientTransport({
            mailbox,
            apiUrl: 'mem://server/api',
            clientAddress: 'mem://client/inbox'
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should initialize correctly with apiUrl and clientAddress', () => {
        expect((transport as any).serverAddress).toBe('mem://server/api');
        expect((transport as any).clientAddress).toBe('mem://client/inbox');
    });

    it('should subscribe on start', async () => {
        await transport.start();
        expect(mailbox.subscribe).toHaveBeenCalledWith('mem://client/inbox', expect.any(Function));
    });

    it('should post message with correct headers in _fetch', async () => {
        const fetchPromise = transport._fetch('my-tool', { arg: 1 }, 'act', 'id-123', {
            headers: { 'req-id': 'custom-id', 'trace-id': 'trace-1' }
        }).catch(() => {}); // Handle rejection from stop()

        expect(mailbox.post).toHaveBeenCalledWith(expect.objectContaining({
            from: 'mem://client/inbox',
            to: 'mem://server/api',
            body: { arg: 1 },
            headers: expect.objectContaining({
                'req-id': 'custom-id',
                'mbx-reply-to': 'mem://client/inbox',
                [RPC_HEADERS.TOOL_ID]: 'my-tool',
                [RPC_HEADERS.ACT]: 'act',
                [RPC_HEADERS.RES_ID]: 'id-123',
                'trace-id': 'trace-1'
            })
        }));
        
        await transport.stop();
        await fetchPromise;
    });

    it('should resolve with body when onResponse is called', async () => {
        await transport.start();
        const fetchPromise = transport._fetch('tool', {}, 'act', 'id', {
            headers: { 'req-id': 'req-1' }
        });

        // Simulate response
        const onResponse = (mailbox.subscribe as any).mock.calls[0][1];
        onResponse({
            headers: { 'req-id': 'req-1' },
            body: { result: 'success' }
        });

        const result = await fetchPromise;
        expect(result).toEqual({ result: 'success' });
    });

    it('should handle 102 status in onResponse', async () => {
        await transport.start();
        const fetchPromise = transport._fetch('tool', {}, 'act', 'id', {
            headers: { 'req-id': 'req-102' }
        });

        const onResponse = (mailbox.subscribe as any).mock.calls[0][1];
        onResponse({
            headers: { 'req-id': 'req-102' },
            body: { status: 102, message: 'Processing' }
        });

        const result: any = await fetchPromise;
        expect(result.status).toBe(102);
    });

    it('should reject with Error when error is present in response body', async () => {
        await transport.start();
        const fetchPromise = transport._fetch('tool', {}, 'act', 'id', {
            headers: { 'req-id': 'req-err' }
        });

        const onResponse = (mailbox.subscribe as any).mock.calls[0][1];
        onResponse({
            headers: { 'req-id': 'req-err' },
            body: { 
                error: { message: 'Server Fail', code: 5001, status: 'internal_error' }
            }
        });

        await expect(fetchPromise).rejects.toThrow('Server Fail');
        try {
            await fetchPromise;
        } catch (err: any) {
            expect(err.code).toBe(5001);
            expect(err.status).toBe('internal_error');
        }
    });

    it('should timeout if no response is received', async () => {
        const fetchPromise = transport._fetch('tool', {}, 'act', 'id', {
            headers: { 'req-id': 'req-timeout' },
            timeout: 100
        });

        vi.advanceTimersByTime(500); // Wait more than 100ms + 200ms buffer

        await expect(fetchPromise).rejects.toThrow(/Request timeout/);
    });

    it('should handle AbortSignal', async () => {
        const controller = new AbortController();
        const fetchPromise = transport._fetch('tool', {}, 'act', 'id', {
            headers: { 'req-id': 'req-abort' },
            signal: controller.signal
        });

        controller.abort('user cancel');

        await expect(fetchPromise).rejects.toThrow('The operation was aborted');
    });

    it('should honour the transport-level timeout option', async () => {
        // 旧实现把 options.timeout 存进 this.timeout 却从不读：本地定时器仍是 30200ms
        mailbox.post = vi.fn().mockReturnValue(new Promise(() => {}));
        const client = new MailboxClientTransport({
            mailbox,
            apiUrl: 'mem://server/api',
            clientAddress: 'mem://client/inbox',
            timeout: 500,
        });

        let failure: any;
        client._fetch('tool', {}).catch(err => { failure = err; });

        await vi.advanceTimersByTimeAsync(600);      // 500 + 200ms 宽限，还没到
        expect(failure).toBeUndefined();

        await vi.advanceTimersByTimeAsync(200);      // 到 700ms
        expect(failure).toBeInstanceOf(Error);
        expect(String(failure?.message)).toContain('700');
    });

    it('should correlate responses with RPC_HEADERS.REQUEST_ID, not a literal', async () => {
        mailbox.post = vi.fn().mockResolvedValue(undefined);
        const postedHeaders = () => (mailbox.post as any).mock.calls[0][0].headers;

        // 不能 await _fetch：它要等到响应回来才结算，而响应是下面手动送进去的
        const pending = transport._fetch('tool', { a: 1 });
        // post 在 Promise 执行体里同步发出，这里不需要等
        expect(postedHeaders()[RPC_HEADERS.REQUEST_ID]).toBeTruthy();

        // 服务端回显同一个 header 名，客户端才能对上 pending 表
        const reqId = postedHeaders()[RPC_HEADERS.REQUEST_ID];
        (transport as any).onResponse({
            body: { ok: true },
            headers: { [RPC_HEADERS.REQUEST_ID]: reqId },
        });
        // 关联上了才会结算；对不上就始终挂在 pending 表里直到超时
        await expect(pending).resolves.toEqual({ ok: true });
        expect((transport as any).pendingRequests.size).toBe(0);
    });

    it('should reject all pending requests on stop', async () => {
        const p1 = transport._fetch('tool1', {}, 'act', 'id', { headers: { 'req-id': '1' } });
        const p2 = transport._fetch('tool2', {}, 'act', 'id', { headers: { 'req-id': '2' } });

        await transport.stop();

        await expect(p1).rejects.toThrow('Transport stopped');
        await expect(p2).rejects.toThrow('Transport stopped');
    });
});
