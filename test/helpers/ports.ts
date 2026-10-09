import { withFreePort } from '@isdk/util'
import type { IServerToolTransport } from '../../src/transports/server'

/**
 * 让内核挑端口（`port: 0`）并监听，然后从绑定观测里读回真实端口。
 *
 * 不要用 `findPort()` 再拿那个端口去 bind：它是「探测 → 关闭 → 交给被测代码 bind」，
 * 探测与真实 bind 之间有 TOCTOU 窗口。vitest 每个测试文件跑在独立 worker 进程里，
 * `findPort` 的进程内串行（以及 EADDRINUSE 时递增重试）跨不了进程，两个套件从同一个
 * 起始端口出发就会同时认为它空闲，后 bind 的那个随机 EADDRINUSE。
 *
 * `port: 0` 由内核在 listen 那一刻原子地分配，没有窗口。端口从 `getBoundAddress()`
 * （绑定观测）读，而不是从声明身份读——后者按设计不随内核端口变化。
 *
 * 路由要在 start 之前声明（物理路由表在 `_start` 里登记），所以这里用**裸 path 前缀**
 * 声明路由（只说路由、不说底座），端口留到监听之后再拼给客户端。
 */
export async function startOnKernelPort(
  transport: IServerToolTransport,
  host = 'localhost'
): Promise<number> {
  await transport.start({ port: 0, host })
  return kernelPort(transport)
}

/**
 * 给「必须预先知道端口号」的用例预留一个端口。
 *
 * 这类用例不能用 `startOnKernelPort`：它们把端口写进 apiUrl 来派生声明身份（或让两个
 * transport 落到同一个物理底座），号码必须是已知的。
 *
 * 但也不要直接用 `findPort()`：号码是建议性的，探测 socket 一关就可能被别的进程抢走。
 * `withFreePort` 把窗口压到 factory 自己的 setup，并且窗口内真被抢走时换下一个号码重跑
 * factory，而不是让用例随机 EADDRINUSE。
 *
 * factory 必须可重跑，且只放「构造 + 监听」：监听一旦成功端口就归我们，之后的断言不可能
 * 再冲突，放进来反而会让重试重跑断言。（`_start` 失败时会把脏底座从共享池里删掉，
 * 所以换号重跑不会留下残留。）
 */
export async function withReservedPort<T>(
  from: number,
  factory: (port: number) => Promise<T> | T,
  host?: string
): Promise<T> {
  return withFreePort(factory, from, host ? { host } : undefined)
}

/** 绑定观测（`address:port`）里的端口。 */
export function kernelPort(transport: IServerToolTransport): number {
  const bound = transport.getBoundAddress?.()
  if (!bound) {throw new Error(`${transport.constructor.name} is not listening — call start() first`);}
  const port = Number(String(bound).split(':').pop())
  if (!Number.isInteger(port) || port <= 0) {throw new Error(`cannot read a port from bound address "${bound}"`);}
  return port;
}
