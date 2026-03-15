import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientToolTransport } from './client';
import { ActionName } from '../consts';
import { RPC_HEADERS, RpcStatusCode } from './models';

// Mock concrete implementation
class MockClientTransport extends ClientToolTransport {
    public _fetch = vi.fn();
    public toObject = vi.fn().mockImplementation((res) => res?.data || res);
}

describe('ClientToolTransport (Base Class)', () => {
    let transport: MockClientTransport;

    beforeEach(() => {
        transport = new MockClientTransport('http://localhost/api');
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should implement retry polling when receiving 102 status', async () => {
        // First call: 102
        transport._fetch.mockResolvedValueOnce({
            status: RpcStatusCode.PROCESSING,
            headers: { [RPC_HEADERS.RETRY_AFTER]: '50' }
        });
        
        // Second call (poll): 102
        transport._fetch.mockResolvedValueOnce({
            status: RpcStatusCode.PROCESSING,
            headers: { [RPC_HEADERS.RETRY_AFTER]: '100' }
        });

        // Third call (poll): 200
        transport._fetch.mockResolvedValueOnce({
            status: RpcStatusCode.OK,
            data: { finalResult: 42 }
        });

        const fetchPromise = transport.fetch('longTask', { a: 1 });

        // Wait for first call to finish and start the first setTimeout
        await Promise.resolve(); // initial fetch call
        await Promise.resolve(); // while (res.status === 102) check
        await Promise.resolve(); // entering while loop

        // 1. Wait for first retry (50ms)
        await vi.advanceTimersByTimeAsync(60);
        await Promise.resolve(); // second _fetch (poll) finish

        // 2. Wait for second retry (100ms)
        await vi.advanceTimersByTimeAsync(110);
        await Promise.resolve(); // third _fetch (poll) finish
        await Promise.resolve(); // return toObject

        const result = await fetchPromise;
        expect(result).toEqual({ finalResult: 42 });
        expect(transport._fetch).toHaveBeenCalledTimes(3);
        
        // Verify poll arguments
        const pollCall = transport._fetch.mock.calls[1];
        expect(pollCall[0]).toBe('rpcTask');
        expect(pollCall[2]).toBe('get'); // action should be 'get' for polling
    });

    it('should respect stream: true by not calling toObject', async () => {
        const mockStream = { getReader: vi.fn() };
        transport._fetch.mockResolvedValue({
            status: RpcStatusCode.OK,
            data: mockStream
        });

        const result = await transport.fetch('streamTool', { stream: true });
        
        expect(result.data).toBe(mockStream);
        expect(transport.toObject).not.toHaveBeenCalled();
    });

    it('should handle missing retry-after by using default value', async () => {
        transport._fetch.mockResolvedValueOnce({
            status: RpcStatusCode.PROCESSING,
            headers: {} // No retry-after
        });
        transport._fetch.mockResolvedValueOnce({
            status: RpcStatusCode.OK,
            data: 'done'
        });

        const fetchPromise = transport.fetch('task', {});
        await Promise.resolve();
        
        // Advance default 1000ms (as defined in RPC_DEFAULTS)
        vi.advanceTimersByTime(1100);
        await Promise.resolve();

        const result = await fetchPromise;
        expect(result).toBe('done');
    });

    it('should properly generate requestId if not provided', async () => {
        transport._fetch.mockResolvedValue({ status: 200 });
        await transport.fetch('tool', {});
        
        const callOptions = transport._fetch.mock.calls[0][4];
        expect(callOptions.headers[RPC_HEADERS.REQUEST_ID]).toBeDefined();
    });
});
