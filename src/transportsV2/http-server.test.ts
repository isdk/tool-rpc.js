import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpServerToolTransport } from './http-server';
import { RpcServerDispatcher } from './dispatcher';
import { ToolRpcRequest, RpcStatusCode, RPC_HEADERS } from './models';
import http from 'http';

describe('HttpServerToolTransport', () => {
   let transport: HttpServerToolTransport;
   let dispatcher: RpcServerDispatcher;

   beforeEach(() => {
      dispatcher = new RpcServerDispatcher();
      dispatcher.dispatch = vi.fn().mockResolvedValue({ status: 200, data: { ok: true } });

      transport = new HttpServerToolTransport({ dispatcher });
      transport.addRpcHandler('http://localhost/api');
   });

   afterEach(() => {
      vi.restoreAllMocks();
   });

   it('should extract target routing from headers first (Waterfall priority 1)', async () => {
      let dispatchedReq: ToolRpcRequest | null = null;
      dispatcher.dispatch = vi.fn().mockImplementation(async (req) => {
         dispatchedReq = req;
         return { status: 200, data: {} };
      });

      const mockReq = {
         url: '/api/some/random/path',
         method: 'POST',
         headers: {
            host: 'localhost',
            [RPC_HEADERS.FUNC]: 'explicit-tool',
            [RPC_HEADERS.ACT]: 'upload',
            [RPC_HEADERS.RES_ID]: 'user1'
         },
         on: (event: string, cb: any) => {
            if (event === 'data') cb(JSON.stringify({ a: 1 }));
            if (event === 'end') cb();
         }
      } as unknown as http.IncomingMessage;

      const mockRes = {
         setHeader: vi.fn(),
         end: vi.fn()
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      expect(dispatchedReq).toBeDefined();
      expect(dispatchedReq!.toolId).toBe('explicit-tool');
      expect(dispatchedReq!.act).toBe('upload');
      expect(dispatchedReq!.resId).toBe('user1');
      expect(dispatchedReq!.params).toMatchObject({ a: 1 });
   });

   it('should fallback to URL path parsing if headers are missing (Waterfall priority 2)', async () => {
      let dispatchedReq: ToolRpcRequest | null = null;
      dispatcher.dispatch = vi.fn().mockImplementation(async (req) => {
         dispatchedReq = req;
         return { status: 200, data: {} };
      });

      const mockReq = {
         url: '/api/implicit-tool/implicit-id?q=1',
         method: 'POST',
         headers: { host: 'localhost' },
         on: (event: string, cb: any) => {
            if (event === 'end') cb();
         }
      } as unknown as http.IncomingMessage;

      const mockRes = { 
         setHeader: vi.fn(), 
         end: vi.fn(),
         on: vi.fn() // Add mock listener
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      expect(dispatchedReq).toBeDefined();
      expect(dispatchedReq!.toolId).toBe('implicit-tool');
      expect(dispatchedReq!.resId).toBe('implicit-id');
      expect(dispatchedReq!.act).toBeUndefined();
   });

   it('should send standard 400 error when NO routing info is found', async () => {
      const mockReq = {
         url: '/api/',  // empty tool path
         method: 'POST',
         headers: { host: 'localhost' },
         on: (event: string, cb: any) => { if (event === 'end') cb(); }
      } as unknown as http.IncomingMessage;

      const mockRes = {
         setHeader: vi.fn(),
         end: vi.fn()
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      // Since it couldn't find tool, it should have sent a 400 response
      expect(mockRes.statusCode).toBe(400);
      const output = (mockRes.end as any).mock.calls[0][0];
      expect(output).toContain('Missing routing information');
   });

   it('should pipe response streams correctly', async () => {
      const mockPipe = vi.fn();
      const mockStream = { pipe: mockPipe };

      dispatcher.dispatch = vi.fn().mockResolvedValue({ status: 200, data: mockStream });

      const mockReq = {
         url: '/api/test', method: 'POST', headers: {},
         on: (event: string, cb: any) => { if (event === 'end') cb(); }
      } as unknown as http.IncomingMessage;

      const mockRes = { 
         setHeader: vi.fn(), 
         end: vi.fn(),
         on: vi.fn() // Add mock listener
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      expect(mockPipe).toHaveBeenCalledWith(mockRes);
   });

   it('should securely pipe response streams from rpcTask polling (Bug Fixed)', async () => {
      const mockPipe = vi.fn();
      const mockStream = { pipe: mockPipe };

      // dispatcher returns the unwrapped stream because rpcTask acts as a proxy
      dispatcher.dispatch = vi.fn().mockResolvedValue({
         status: 200,
         data: mockStream
      });

      const mockReq = {
         url: '/api/rpcTask/req-123', method: 'GET', headers: {},
         on: (event: string, cb: any) => { if (event === 'end') cb(); }
      } as unknown as http.IncomingMessage;

      const mockRes = { 
         setHeader: vi.fn(), 
         end: vi.fn(),
         on: vi.fn() // Add mock listener
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      // Because data is the bare proxy stream, transport natively discovers `.pipe` and executes it!
      expect(mockPipe).toHaveBeenCalledWith(mockRes);
      expect(mockRes.end).not.toHaveBeenCalled(); // No more JSON stringifying
   });

   it('should handle malformed JSON body gracefully', async () => {
      const mockReq = {
         url: '/api/tool',
         method: 'POST',
         headers: { host: 'localhost' },
         on: (event: string, cb: any) => {
            if (event === 'data') cb('{ invalid json'); // Invalid JSON
            if (event === 'end') cb();
         }
      } as unknown as http.IncomingMessage;

      const mockRes = {
         setHeader: vi.fn(),
         end: vi.fn()
      } as unknown as http.ServerResponse;

      await (transport as any).processIncomingCall(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(500);
      const errorOutput = JSON.parse((mockRes.end as any).mock.calls[0][0]);
      expect(errorOutput.error).toBeDefined();
      expect(errorOutput.error.message).toBeTruthy();
   });

   it('should invoke discovery handler when URL matches', async () => {
      const discoveryFn = vi.fn().mockReturnValue(['tool1', 'tool2']);
      transport.addDiscoveryHandler('http://localhost/api/_discovery', discoveryFn);

      const mockReq = {
         url: '/api/_discovery',
         method: 'GET',
         headers: { host: 'localhost' }
      } as unknown as http.IncomingMessage;

      const mockRes = {
         setHeader: vi.fn(),
         end: vi.fn()
      } as unknown as http.ServerResponse;

      // Access private requestListener
      await (transport as any).requestListener(mockReq, mockRes);

      expect(discoveryFn).toHaveBeenCalled();
      expect(mockRes.statusCode).toBe(200);
      expect((mockRes.end as any).mock.calls[0][0]).toContain('["tool1","tool2"]');
   });

   it('should 404 on unknown paths', async () => {
      const mockReq = {
         url: '/unknown/path',
         method: 'GET',
         headers: { host: 'localhost' }
      } as unknown as http.IncomingMessage;

      const mockRes = {
         setHeader: vi.fn(),
         end: vi.fn()
      } as unknown as http.ServerResponse;

      await (transport as any).requestListener(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(404);
   });
});
