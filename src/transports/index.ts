export * from './models';
export * from './base';
// 传输层地址 helper：只对外导出**实测有外部消费者**的那几个（判据见
// `src/transports/README.cn.md` 的「公开面判据」）。`getListenAddr()` 报一个字符串就够，下面这几个是「要监听真实
// TCP/unix 底座」时才需要的：bind 参数解析、监听前推地址、监听后把观测值换成地址。
// `normalizeNativeAddress` / `hasUriScheme` / `withBindOptions` / `nativeAddressFromBind`
// 是它们的内部通道，不对外。
export type { BindOptions, ResolvedListenBind } from './socket-address';
export {
  normalizeSocketAddress,
  normalizeHostAndPort,
  normalizeListenBind,
  socketAddressFromBind,
  socketAddressFromListen,
  unixSocketPath,
  unixSocketUri,
} from './socket-address';
// 身份策略（设计见根目录 IDENTITY_POLICY_DESIGN.cn.md）：走**显式**导出，与 browser.ts 同一份名单
// （那两个入口其余行是 export *，靠它带出的符号没人钉）。名单在 `test/browser-entry.test.ts`。
export type {
  RpcIdentity,
  RpcIdentityContext,
  RpcCredentialReader,
  RpcCredentialSource,
  RpcIdentityPolicy,
  RpcCredentialRegistry,
} from './identity';
export { RpcSessionIdentityPolicy, RpcInProcessCredentialRegistry } from './identity-session';
export type { RpcSessionIdentityOptions } from './identity-session';
// 两个 bearer 解析 helper 也对外：下游自己写 reader 时复用那一段 RFC 7235 解析
// （`tool-event` 在用），否则同一个请求两个包会给出不同答案。
export { RpcBearerPolicy, readBearerCredential, parseBearerCredential } from './identity-bearer';
export type { RpcVerifiedCredentialOptions } from './identity-bearer';
export * from './server';
export * from './client';
export * from './dispatcher';
export * from './task-tracker';
export * from './deadline-guard';
export * from './rpc-task';
// 内置发现工具（`rpcApis`）：与 rpcTask 同属系统保留工具，导出是为了下游能引用它
// （换实现、断言 id），不是为了让他们手动注册。
export * from './rpc-apis';
// 传输层地址 helper 在上面（与 http-server.ts 分开：那边是 HTTP 自己的物理底座池——
// 池/refCount/前缀分发；任何服务 HTTP 的 transport 都只要那几样纯函数）。
// `normalizeHostAndPort` 也在对外面：Host 那种客户端可控的 `host[:port]` 字符串进
// SSRF / 白名单匹配前必须先归一，否则 `Host: LocalHost` 就绕过针对 `localhost` 的限制——
// 任何从客户端 host 推身份的服务端 transport（含 tool-rpc-fastify）都需要同一个写法。
export { HttpServerToolTransport } from './http-server';
export type { HttpServerToolTransportOptions } from './http-server';
export * from './http-client';
export * from './mailbox-client';
export * from './mailbox-server';
export * from './server-manager';
