import { describe, it, expect } from 'vitest';
import { normalizeSocketAddress, socketAddressFromBind } from './socket-address';
import { normalizeListenBind } from './socket-address';

/**
 * HTTP 家族「底座」层的规则单测：地址归一、bind 参数解析、声明地址推导。
 *
 * 这些规则被 `HttpServerToolTransport` 与 `FastifyServerToolTransport` 共用，
 * 所以它们必须在这里钉住，而不是只靠两个 transport 的集成测试各自覆盖一遍——
 * 以前就是「各写一遍」才让 socket 别名与默认 bind 漂移。
 */
describe('normalizeListenBind', () => {
   it('认 socket 的三个别名，且 socket 优先于 host/port', () => {
      expect(normalizeListenBind({ path: '/run/ai.sock' })).toEqual({ socket: '/run/ai.sock' });
      expect(normalizeListenBind({ socketPath: '/run/ai.sock' })).toEqual({ socket: '/run/ai.sock' });
      expect(normalizeListenBind({ socket: '/run/ai.sock' })).toEqual({ socket: '/run/ai.sock' });
      // 与 Node「给了 port 就忽略 path」相反：声明身份与真实监听必须是同一个底座
      expect(normalizeListenBind({ path: '/run/ai.sock', host: '127.0.0.1', port: 3000 }))
         .toEqual({ socket: '/run/ai.sock' });
   });

   it('port 转成数（环境变量那种字符串也要能进来），空值一律 undefined', () => {
      expect(normalizeListenBind({ port: '3000', host: '127.0.0.1' })).toEqual({ port: 3000, host: '127.0.0.1' });
      expect(normalizeListenBind({ port: 0 })).toEqual({ port: 0 });
      expect(normalizeListenBind({ port: '', host: '' })).toEqual({ port: undefined, host: undefined });
      expect(normalizeListenBind()).toEqual({ port: undefined, host: undefined });
      // 空 socket 不算声明了底座，否则 `{ path: '', port: 3000 }` 会去 listen('')
      expect(normalizeListenBind({ path: '', port: 3000 })).toEqual({ port: 3000, host: undefined });
   });

   it('不填默认值：默认属于各 transport（HTTP 监听 0.0.0.0，Fastify 保持自己的默认）', () => {
      expect(normalizeListenBind({ port: 3000 }).host).toBeUndefined();
   });
});

describe('normalizeSocketAddress', () => {
   it('规范化同一个 socket 的两种写法', () => {
      expect(normalizeSocketAddress('http://127.0.0.1:3000')).toBe(normalizeSocketAddress('http://localhost:3000'));
      expect(normalizeSocketAddress('http://0.0.0.0:3000')).toBe(normalizeSocketAddress('http://*:3000'));
      expect(normalizeSocketAddress('127.0.0.1:3000')).toBe('http://localhost:3000');
   });

   it('不预测包含关系：通配与具体 host、不同 host 同端口，都不相等', () => {
      expect(normalizeSocketAddress('http://*:3000')).not.toBe(normalizeSocketAddress('http://localhost:3000'));
      expect(normalizeSocketAddress('http://10.0.0.1:3000')).not.toBe(normalizeSocketAddress('http://10.0.0.2:3000'));
   });

   it('裸 path 不是地址：不补成 http://api', () => {
      expect(normalizeSocketAddress('/api')).toBe('/api');
   });
});

describe('socketAddressFromBind', () => {
   it('socket 声明优先：apiUrl 写着端口也没用，底座就是那个文件', () => {
      expect(socketAddressFromBind({ apiUrl: 'http://localhost:3000', bind: { path: '/run/ai.sock' } }))
         .toBe('unix:/run/ai.sock');
   });

   it('apiUrl 的 authority 被本轮 bind 改写（start({ port }) 是声明，不是观测）', () => {
      expect(socketAddressFromBind({ apiUrl: 'http://localhost:3000/rpc', bind: { port: 4321 } }))
         .toBe('http://localhost:4321');
      expect(socketAddressFromBind({ apiUrl: 'http://localhost:3000/rpc', bind: { host: '0.0.0.0' } }))
         .toBe('http://*:3000');
      // port: 0 是「内核挑一个」，属于观测：不改写，key 跨 start 边界仍然稳定
      expect(socketAddressFromBind({ apiUrl: 'http://localhost:3000/rpc', bind: { port: 0 } }))
         .toBe('http://localhost:3000');
   });

   it('apiUrl 是裸 path 前缀时，bind 参数就是关于底座的唯一声明', () => {
      expect(socketAddressFromBind({ apiUrl: '/api', bind: { host: '127.0.0.1', port: 4321 } }))
         .toBe('http://localhost:4321');
   });

   it('bindDefaults 只补裸 path 那条路：HTTP 要传（自己就是监听者），Fastify 不传（共享实例不该假装占着端口）', () => {
      const defaults = { port: 3000, host: '0.0.0.0' };
      expect(socketAddressFromBind({ apiUrl: '/api', bind: {}, bindDefaults: defaults })).toBe('http://*:3000');
      expect(socketAddressFromBind({ apiUrl: '/api', bind: {} })).toBeUndefined();
      // 有 scheme 时默认值不参与：apiUrl 自己就说了底座
      expect(socketAddressFromBind({ apiUrl: 'http://localhost:3000', bind: {}, bindDefaults: defaults }))
         .toBe('http://localhost:3000');
   });

   it('没有底座可说时返回 undefined，由调用方兜底（裸 path、空、别的 scheme）', () => {
      expect(socketAddressFromBind({ apiUrl: '/api' })).toBeUndefined();
      expect(socketAddressFromBind({ apiUrl: '' })).toBeUndefined();
      expect(socketAddressFromBind({ apiUrl: 'mailbox://bus-a' })).toBeUndefined();
   });

   it('声明值与观测值过同一个归一化：两边对上同一个 key', () => {
      // 声明：apiUrl 写 localhost；观测：内核报 127.0.0.1
      const declared = socketAddressFromBind({ apiUrl: 'http://localhost:3000', bind: {} });
      const observed = normalizeSocketAddress('http://127.0.0.1:3000');
      expect(declared).toBe(observed);
   });
});
