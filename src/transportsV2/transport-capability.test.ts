import { describe, it, expect, vi } from 'vitest';
import { MailboxServerTransport } from './mailbox-server';
import { RpcServerDispatcher } from './dispatcher';
import { RpcStatusCode } from './models';

describe('Transport V2: Protocol Capability & Streaming', () => {

   it('should handle streaming output gracefully on non-streaming transport (Mailbox)', async () => {
      const dispatcher = new RpcServerDispatcher();

      // 模拟一个返回流的工具
      const mockStream = new ReadableStream({
         start(controller) {
            controller.enqueue('chunk1');
            controller.close();
         }
      });

      // 强制分发器返回一个流
      dispatcher.dispatch = vi.fn().mockResolvedValue({
         status: 200,
         data: mockStream
      });

      const transport = new MailboxServerTransport({
         apiUrl: 'mailbox://test',
         dispatcher
      });

      // 监控 Mailbox 发送动作
      const postSpy = vi.spyOn((transport as any).mailbox, 'post').mockResolvedValue(true as any);

      // 模拟收到请求
      const mockMsg = {
         id: 'msg1',
         headers: { 'req-id': 'req1', 'rpc-fn': 'streamTool' },
         body: {}
      };

      await (transport as any).onReceive(mockMsg);

      // 验证：传输层由于不支持流，应当检测到并返回一个错误消息，而不是尝试发送流对象
      const lastCall = postSpy.mock.calls[postSpy.mock.calls.length - 1][0] as any;

      // 预期失败：目前代码直接发送了流对象，导致 body.error 未定义
      expect(lastCall.body.error).toBeDefined();
      expect(lastCall.body.error.message).toMatch(/not supported by/i);
   });
});
