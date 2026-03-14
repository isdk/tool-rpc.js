import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClientToolTransport } from './http-client';
import { RPC_HEADERS } from './models';

describe('HttpClientToolTransport', () => {
    let transport: HttpClientToolTransport;

    beforeEach(() => {
        transport = new HttpClientToolTransport('http://localhost:3000');
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should inject correct headers for RPC requests', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ success: true })
        });

        await transport._fetch('my-tool', { arg1: 1 }, 'testAction', 'res-123');

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const callArgs = (globalThis.fetch as any).mock.calls[0];
        const url = callArgs[0];
        const options = callArgs[1];

        expect(url).toBe('http://localhost:3000/my-tool/res-123');
        expect(options.method).toBe('POST'); // Default without GET act
        expect(options.headers[RPC_HEADERS.FUNC]).toBe('my-tool');
        expect(options.headers[RPC_HEADERS.ACT]).toBe('testAction');
        expect(options.headers[RPC_HEADERS.RES_ID]).toBe('res-123');
        expect(options.body).toBe(JSON.stringify({ arg1: 1 }));
    });

    it('should use GET method mapping for "get" action and append query params', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ result: 'ok' })
        });

        await transport._fetch('rpcTask', { arg2: 2 }, 'get', 'req-1');

        const callArgs = (globalThis.fetch as any).mock.calls[0];
        const url = new URL(callArgs[0]);
        const options = callArgs[1];

        expect(options.method).toBe('GET');
        expect(url.pathname).toBe('/rpcTask/req-1');
        expect(url.searchParams.get('p')).toBe(JSON.stringify({ arg2: 2 }));
        expect(options.body).toBeUndefined(); // GET logic should not have body
    });

    it('should return raw 102 processing object if HTTP status is 102', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            status: 102,
            headers: new Headers({ 
                [RPC_HEADERS.RETRY_AFTER]: '2000',
                'retry-after': '1000' 
            }),
        });

        const res = await transport._fetch('my-tool', undefined, undefined, undefined);

        expect(res.status).toBe(102);
        expect((res.headers as any)[RPC_HEADERS.RETRY_AFTER]).toBe('2000');
        expect((res.headers as any)['retry-after']).toBe('1000');
    });

    it('should throw Error if HTTP fails with non 102', async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ error: { message: "Validation strictness" } })
        });

        try {
            await transport._fetch('validate', { bad: true });
            expect.fail('Should thrust error');
        } catch (err: any) {
            expect(err.message).toMatch('Validation strictness');
        }
    });

    it('toObject should correctly yield json or pass through 102 object', async () => {
        const obj102 = await transport.toObject({ status: 102 });
        expect(obj102.status).toBe(102);

        const objJson = await transport.toObject({
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ k: 'v' })
        });
        expect(objJson.k).toBe('v');
    });
});
