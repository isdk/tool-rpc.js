// Browser-compatible transport modules
// Excludes Node.js-only modules (http-server, mailbox-server, mailbox-client, etc.)
export * from './models';
export * from './base';
export * from './client';
export * from './http-client';
export * from './client-manager';
export * from './compat';
// Server-side transport infrastructure (browser-compatible)
// 与 Node 入口同一份底座地址工具（纯字符串，无 Node API）：只留实测有外部消费者的
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
export * from './server';
export * from './dispatcher';
export * from './server-manager';
export * from './task-tracker';
export * from './deadline-guard';
export * from './rpc-task';
