// Browser-compatible transport modules
// Excludes Node.js-only modules (http-server, mailbox-server, mailbox-client, etc.)
export * from './models';
export * from './base';
export * from './client';
export * from './http-client';
export * from './client-manager';
export * from './compat';
// Server-side transport infrastructure (browser-compatible)
// 与 Node 入口同一份传输层地址 helper（纯字符串，无 Node API）：只留实测有外部消费者的
// 那几个，名单与 Node 入口必须一致（`test/browser-entry.test.ts` 钉着）。
export type { BindOptions, ResolvedListenBind } from './socket-address';
export {
  normalizeHostAndPort,
  normalizeSocketAddress,
  normalizeListenBind,
  socketAddressFromBind,
  socketAddressFromListen,
  unixSocketPath,
  unixSocketUri,
} from './socket-address';
// 身份策略：browser-safe（不碰监听对象、不碰 http 模块、不 import Node 内建模块），
// 名单与 Node 入口必须一致（`test/browser-entry.test.ts` 钉着）。
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
export { RpcBearerPolicy } from './identity-bearer';
export type { RpcVerifiedCredentialOptions } from './identity-bearer';
export * from './server';
export * from './dispatcher';
export * from './server-manager';
export * from './task-tracker';
export * from './deadline-guard';
export * from './rpc-task';
// 内置发现工具（与 Node 入口同一份名单，`test/browser-entry.test.ts` 钉着）
export * from './rpc-apis';
