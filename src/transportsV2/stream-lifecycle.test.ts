import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import { EventEmitter } from 'events';
import { RpcServerDispatcher } from './dispatcher';
import { HttpServerToolTransport } from './http-server';
import { RpcActiveTaskTracker } from './task-tracker';
import { ToolRpcRequest } from './models';

describe('Stream Lifecycle & Backpressure', () => {
  let dispatcher: RpcServerDispatcher;
  let transport: HttpServerToolTransport;
  let tracker: RpcActiveTaskTracker;

  beforeEach(() => {
    // Mock Readable.fromWeb if not present
    // if (typeof (Readable as any).fromWeb !== 'function') {
    //   (Readable as any).fromWeb = vi.fn().mockImplementation((webStream) => {
    //     const nodeStream = new Readable({ read() { } });
    //     nodeStream._destroy = (err: any, cb: any) => {
    //       webStream.cancel(err).then(() => cb(err)).catch((e: any) => cb(e));
    //     };
    //     return nodeStream;
    //   });
    // }

    tracker = new RpcActiveTaskTracker();
    dispatcher = new RpcServerDispatcher({ tracker });
    transport = new HttpServerToolTransport({ dispatcher });
    transport.addRpcHandler('http://localhost/api/');
  });

  afterEach(() => {
    tracker.stop();
  });

  it('should destroy stream and clean up handle when physical connection closes', async () => {
    const streamCancelSpy = vi.fn();
    const mockWebStream = new ReadableStream({
      start(controller) { controller.enqueue('chunk1'); },
      cancel: streamCancelSpy
    });

    const mockRun = vi.fn().mockReturnValue(mockWebStream);
    dispatcher.registry = { get: () => ({ run: mockRun, stream: true }) };

    const mockReq = new EventEmitter() as any;
    mockReq.url = '/api/stream-tool';
    mockReq.method = 'POST';
    mockReq.headers = {};

    const mockRes = new EventEmitter() as any;
    mockRes.setHeader = vi.fn();
    mockRes.end = vi.fn();
    mockRes.write = vi.fn();
    mockRes.writable = true;
    mockRes.destroy = vi.fn();

    const processingPromise = (transport as any).processIncomingCall(mockReq, mockRes);
    mockReq.emit('end');

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(tracker['tasks'].size).toBe(1);

    mockRes.emit('close');

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(streamCancelSpy).toHaveBeenCalledWith(expect.stringContaining('Physical connection closed'));
  });

  it('should actively cancel stream when task is aborted via Tracker', async () => {
    let controller: ReadableStreamDefaultController;
    const streamCancelSpy = vi.fn();

    const mockWebStream = new ReadableStream({
      start(c) { controller = c; },
      cancel: streamCancelSpy
    });

    const mockRun = vi.fn().mockReturnValue(mockWebStream);
    dispatcher.registry = { get: () => ({ run: mockRun, stream: true }) };

    const req: ToolRpcRequest = {
      apiUrl: 'http://test', toolId: 'stream-tool', requestId: 'task-1', params: {}, headers: {}
    };

    const res = await dispatcher.dispatch(req);
    expect(res.data).toBeInstanceOf(ReadableStream);

    const handle = tracker.get('task-1');
    expect(handle).toBeDefined();

    handle?.abort('User Cancelled');

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(streamCancelSpy).toHaveBeenCalledWith('User Cancelled');
    expect(handle?.status).toBe('aborted');
  });

  it('should attach Transformer to stream in Dispatcher', async () => {
    const mockWebStream = new ReadableStream({
      start(c) { c.enqueue('data'); c.close(); }
    });

    const mockRun = vi.fn().mockReturnValue(mockWebStream);
    dispatcher.registry = { get: () => ({ run: mockRun, stream: true }) };

    const req: ToolRpcRequest = {
      apiUrl: 'http://test', toolId: 'stream-tool', requestId: 'task-transform', params: {}, headers: {}
    };

    const res = await dispatcher.dispatch(req);
    const returnedStream = res.data as ReadableStream;

    expect(returnedStream).not.toBe(mockWebStream);

    const reader = returnedStream.getReader();
    await reader.read();
    await reader.read();

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(tracker.get('task-transform')).toBeUndefined();
  });
});
