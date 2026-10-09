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

/** 绑定观测（`address:port`）里的端口。 */
export function kernelPort(transport: IServerToolTransport): number {
  const bound = transport.getBoundAddress?.()
  if (!bound) {throw new Error(`${transport.constructor.name} is not listening — call start() first`);}
  const port = Number(String(bound).split(':').pop())
  if (!Number.isInteger(port) || port <= 0) {throw new Error(`cannot read a port from bound address "${bound}"`);}
  return port;
}
