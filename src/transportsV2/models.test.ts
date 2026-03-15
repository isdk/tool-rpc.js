import { describe, it, expect } from 'vitest';
import { RPC_DEFAULTS, RPC_HEADERS, RpcError, RpcStatusCode } from './models';

describe('Models', () => {
  it('should export correct RPC_HEADERS constants', () => {
    expect(RPC_HEADERS.TOOL_ID).toBe('rpc-fn');
    expect(RPC_HEADERS.ACT).toBe('rpc-act');
    expect(RPC_HEADERS.RES_ID).toBe('rpc-res-id');
    expect(RPC_HEADERS.TIMEOUT).toBe('rpc-timeout');
    expect(RPC_HEADERS.TRACE_ID).toBe('trace-id');
    expect(RPC_HEADERS.REQUEST_ID).toBe('req-id');
    expect(RPC_HEADERS.RETRY_AFTER).toBe('rpc-retry-after');
    // Deprecated ones
    expect(RPC_HEADERS.FUNC).toBe('rpc-fn');
  });

  it('should export correct RPC_DEFAULTS constants', () => {
    expect(RPC_DEFAULTS.RETRY_AFTER_MS).toBe(1000);
    expect(RPC_DEFAULTS.GLOBAL_TIMEOUT_MS).toBe(30000);
  });

  it('should export correct RpcStatusCode constants', () => {
    expect(RpcStatusCode.OK).toBe(200);
    expect(RpcStatusCode.PROCESSING).toBe(102);
    expect(RpcStatusCode.BAD_REQUEST).toBe(400);
    expect(RpcStatusCode.NOT_FOUND).toBe(404);
    expect(RpcStatusCode.TERMINATED).toBe(408);
    expect(RpcStatusCode.INTERNAL_ERROR).toBe(500);
    expect(RpcStatusCode.GATEWAY_TIMEOUT).toBe(504);
  });

  it('should initialize RpcError correctly', () => {
    const err = new RpcError('Test Error', 400, 4001, { foo: 'bar' });
    expect(err.message).toBe('Test Error');
    expect(err.status).toBe(400);
    expect(err.code).toBe(4001);
    expect(err.data).toEqual({ foo: 'bar' });
    expect(err.name).toBe('RpcError');
    expect(err).toBeInstanceOf(Error);
  });
});
