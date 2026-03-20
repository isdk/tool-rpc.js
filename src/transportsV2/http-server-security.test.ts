import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpServerToolTransport } from './http-server';
import { RpcServerDispatcher } from './dispatcher';
import http from 'http';

describe('Transport V2: HTTP Server Security', () => {
   let transport: HttpServerToolTransport;
   let dispatcher: RpcServerDispatcher;

   beforeEach(() => {
      dispatcher = new RpcServerDispatcher();
      transport = new HttpServerToolTransport({ dispatcher });
      transport.addRpcHandler('http://localhost/api');
   });

   afterEach(() => {
      (HttpServerToolTransport as any).sharedServers.clear();
   });

   it('should return 400 (not 500) for malformed JSON body', async () => {
      const mockReq = {
         url: '/api/tool',
         method: 'POST',
         headers: { host: 'localhost' },
         on: (event: string, cb: any) => {
            if (event === 'data') cb('{ invalid: json }'); 
            if (event === 'end') cb();
         }
      } as unknown as http.IncomingMessage;

      const mockRes = {
         setHeader: vi.fn(),
         end: vi.fn(),
         statusCode: 200
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      // 目前代码在 toRpcRequest 中直接 JSON.parse，会导致 processIncomingCall 的 try-catch 捕获并返回 500
      expect(mockRes.statusCode).toBe(400); 
      const body = JSON.parse((mockRes.end as any).mock.calls[0][0]);
      expect(body.error.code).toBe(400);
   });

   it('should reject requests with body exceeding max size (DoS protection)', async () => {
      // 模拟超大 Body
      const largeData = 'a'.repeat(2 * 1024 * 1024); // 2MB

      const mockReq = {
         url: '/api/tool',
         method: 'POST',
         headers: { host: 'localhost', 'content-length': String(largeData.length) },
         on: (event: string, cb: any) => {
            if (event === 'data') cb(largeData);
            if (event === 'end') cb();
         }
      } as unknown as http.IncomingMessage;

      const mockRes = {
         setHeader: vi.fn(),
         end: vi.fn(),
         statusCode: 200
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      // 预期失败：目前代码完全没有检查 Body 大小，会返回 200 或其他逻辑结果（如果 dispatcher 没崩）
      expect(mockRes.statusCode).toBe(413); // Payload Too Large
   });
});
