import { describe, it, expect } from 'vitest';
import { RPC_DEFAULTS, RPC_HEADERS, RpcStatusCode } from './models';

describe('Models', () => {
  it('should export correct RPC_HEADERS constants', () => {
    expect(RPC_HEADERS.TOOL_ID).toBe('x-rpc-func');
    expect(RPC_HEADERS.ACT).toBe('x-rpc-act');
    expect(RPC_HEADERS.RES_ID).toBe('x-rpc-res-id');
    expect(RPC_HEADERS.TIMEOUT).toBe('x-rpc-timeout');
    expect(RPC_HEADERS.TRACE_ID).toBe('x-rpc-trace-id');
    expect(RPC_HEADERS.REQUEST_ID).toBe('x-rpc-request-id');
    expect(RPC_HEADERS.RETRY_AFTER).toBe('x-rpc-retry-after');
    // Deprecated ones
    expect(RPC_HEADERS.FUNC).toBe('x-rpc-func');
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
});
