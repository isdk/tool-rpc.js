import { BaseFuncItem } from "@isdk/tool-func";

/**
 * A tuple of supported action names for remote tool interactions.
 */
export const ActionNames = ['get', 'post', 'put', 'delete', 'patch', 'list', 'res'] as const
/**
 * Represents a valid action name for a remote tool, derived from the `ActionNames` tuple.
 */
export type ActionName = typeof ActionNames[number]

/**
 * 协议自己占用的 act 名（issue #15）。它们跟 `req-id`、`rpc-act` 一样是线协议的一部分：
 * 改名字就是改协议，客户端、端点方法名、文档必须同时改。
 *
 * 端点那边的方法名没法用常量（路由是按方法名反查 act 的），所以两者靠
 * `test/reserved-names.test.ts` 钉在一起。
 */
export const RPC_SPECIAL_ACTIONS = {
  /** 客户端取消一个在途/后台任务：`POST /rpcTask/:resId?act=$cancel` */
  CANCEL: '$cancel',
} as const

/**
 * 框架会读写到 `params` 上的保留参数名（issue #15）。业务工具的参数名不要撞它们：
 * `aborter` 上放真值会被 tool-func 的 cancelable ability 当场拒（`makeClientToolRpcCancelable`
 * 会先一步报出「这是保留名」）。
 */
export const RPC_PARAM_KEYS = {
  /** tool-func 挂在 params 上的本地取消句柄；RPC 不让它上 wire */
  ABORTER: 'aborter',
  /** legacy compat（`enableLegacyCompat`）：服务端把底座原生请求/响应/信号灌进 params */
  REQ: '_req',
  RES: '_res',
  SIGNAL: '_signal',
} as const

/**
 * A schema object defining properties common to all remote tool functions.
 * This is used by `AdvancePropertyManager` to define how these properties are handled.
 * @internal
 */
export const RemoteToolFuncSchema = {
  /**
   * The action for the remote call. This is primarily interpreted as an RPC method name.
   * For HTTP transports, it defaults to being sent as a custom RPC method name (e.g., via POST).
   * Only specific RESTful server implementations might map certain 'action' values (like 'get', 'delete')
   * to corresponding HTTP methods. Defaults to 'post'.
   */
  action: {
    type: 'string',
    assign(value: ActionName, dest: any, src?: any, name?: string, options?: any) {
      return value || 'post'
    },
  },
  /**
   * Optional fetch options, primarily for use with HTTP-based transports.
   * @deprecated Use `transport` instead.
   */
  fetchOptions: { type: 'object' },
  /**
   * If true, allows the function's body to be exported to the client for local execution.
   * This is a server-side setting.
   */
  allowExportFunc: { type: 'boolean' },
  /**
   * The timeout configuration for the remote call.
   * Can be a number (milliseconds) or an object for fine-grained control.
   * `0` means "no deadline at all" (it does NOT mean "inherit the global timeout").
   */
  timeout: { type: ['number', 'object'] },
  /**
   * The expected duration of the remote call in milliseconds.
   * Used for UX improvements like progress bars.
   */
  expectedDuration: { type: 'number' },
  /**
   * If true, indicate the tool function will return a stream.
   */
  stream: { type: 'boolean' },
}

/**
 * Base interface for a remote function's configuration, extending `BaseFuncItem`
 * with properties required for remote execution.
 */
export interface RemoteFuncItem extends BaseFuncItem {
  /**
   * The root endpoint for the remote service.
   * @type {string}
   * @deprecated Use `transport` instead.
   */
  apiRoot?: string
  /**
   * The action to be used for the remote call. This typically represents an RPC method name.
   * Only for RESTful HTTP transports, it might be mapped to a standard HTTP method (e.g., GET, POST)
   * @type {ActionName}
   */
  action?: ActionName
  /**
   * Addtional options to be passed to the underlying `fetch` call in a transport.
   * @type {any}
   */
  fetchOptions?: any
  /**
   * The timeout configuration for the remote call.
   * `0` (either as the number or as `{ value: 0 }`) disables the deadline entirely;
   * leave it `undefined` to inherit the dispatcher's `globalTimeout`.
   */
  timeout?: number | {
    /** The hard timeout in milliseconds. */
    value: number;
    /** The idle timeout for streaming responses in milliseconds. */
    streamIdleTimeout?: number;
    /** Whether to keep the server-side function running after a timeout. */
    keepAliveOnTimeout?: boolean;
  };
  /**
   * The expected duration of the remote call in milliseconds.
   */
  expectedDuration?: number;
  /**
   * Whether the tool returns a stream.
   */
  stream?: boolean;
}
