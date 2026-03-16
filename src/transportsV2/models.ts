import { type ToolFuncContext } from "@isdk/tool-func";

/**
 * 标准 Header 定义。
 */
export const RPC_HEADERS = {
  /** 工具/函数标识 */
  TOOL_ID: 'rpc-fn',
  /** (可选) 动作或子方法 */
  ACT: 'rpc-act',
  /** (可选) 资源唯一标识 (Resource ID) */
  RES_ID: 'rpc-res-id',
  /** 链路追踪 ID */
  TRACE_ID: 'trace-id',
  /** 业务执行超时声明 (ms) */
  TIMEOUT: 'rpc-timeout',
  /** 请求唯一 ID (由客户端生成或传输层补齐，且必须在响应中回显) */
  REQUEST_ID: 'req-id',
  /** 任务退避/轮询间隔参考 (ms) */
  RETRY_AFTER: 'rpc-retry-after',

  // 别名保留，方便过渡
  /** @deprecated use TOOL_ID instead */
  FUNC: 'rpc-fn',
};

/**
 * RPC 协议默认配置值
 */
export const RPC_DEFAULTS = {
  /** 默认后台任务轮询间隔 (ms) */
  RETRY_AFTER_MS: 1000,
  /** 默认全局硬超时时间 (ms) */
  GLOBAL_TIMEOUT_MS: 30000,
  /** 'once' 模式下的物理清理兜底时间 (ms)，默认 1小时 */
  ONCE_FALLBACK_MS: 3600000,
  /** 默认硬超时后的清理宽限期 (ms) */
  TERMINATION_GRACE_MS: 500,
};

/**
 * 任务完成后结果保留模式
 */
export enum RpcTaskRetentionMode {
  /** 任务完成后立即销毁 */
  None = 0,
  /** 永久保留 (直至进程结束或手动删除) */
  Permanent = -1,
  /** 保留至第一次成功读取 (GET) */
  Once = 'once'
}

/**
 * 细粒度的保留策略配置
 */
export interface RpcTaskRetentionConfig {
  /** 保留模式或毫秒数 */
  mode: RpcTaskRetentionMode | number | 'once';
  /** 'once' 模式下的物理清理兜底时间 (ms) */
  onceFallbackMs?: number;
  /** 结果保留的硬性上限时间 (ms)，无论何种模式超过此时间必删 */
  maxRetentionMs?: number;
}

/**
 * 灵活的任务保留策略配置类型
 */
export type RpcTaskRetention = RpcTaskRetentionMode | number | RpcTaskRetentionConfig | 'once';

/**
 * 状态码语义对照表 (物理/逻辑响应状态码)
 */
export enum RpcStatusCode {
  OK = 200,               // 成功
  PROCESSING = 102,       // 任务挂起，仍在后台处理
  BAD_REQUEST = 400,      // 参数/协议能力错误
  NOT_FOUND = 404,        // 找不到工具或资源
  CONFLICT = 409,         // 请求 ID 冲突
  TERMINATED = 408,       // 硬超时终止
  INTERNAL_ERROR = 500,   // 执行错误
  GATEWAY_TIMEOUT = 504,  // 响应超时
}

/**
 * 传输层到调度层的归一化 RPC 请求封包
 */
export interface ToolRpcRequest {
  /** 完整的寻址路径 */
  apiUrl: string;
  /** 工具/函数标识名 */
  toolId: string;
  /** (可选) 动作 */
  act?: string;
  /** (可选) 资源 ID */
  resId?: string;
  /** 追踪 ID */
  traceId?: string;
  /** 本次请求唯一标识 */
  requestId: string;
  /** 已解构的业务参数负载 */
  params: any;
  /** 全量归一化 Header */
  headers: Record<string, string | number | string[] | undefined>;
  /** 逃生口 */
  raw?: any;
}

/**
 * 调度层向传输层的归一化结果对象
 */
export interface ToolRpcResponse {
  /** 响应状态码 (物理协议映射值，如 200, 404, 500) */
  status: number;
  data?: any;
  headers?: Record<string, string | number | string[] | undefined>;
  error?: {
    /** 业务错误码 (对应 HTTP 错误码) */
    code: number;
    /** 状态标识字符串 (可选，如 'not_found', 'missing_params') */
    status?: string;
    message: string;
    data?: any;
    stack?: string;
  };
  raw?: any;
}

/**
 * [V2 核心] 标准执行上下文接口
 */
export interface ToolRpcContext extends ToolFuncContext {
  requestId: string;
  traceId?: string;
  headers: Record<string, string | number | string[] | undefined>;
  dispatcher?: any;
  /** 资源唯一标识 */
  resId?: string;
  /** 操作名称 */
  act?: string;

  /** 下方为协议底座元数据透传 */
  req?: any;
  reply?: any;
}

export class RpcError extends Error {
  /** 业务错误码 (始终是数字) */
  public code: number;
  /** 可选的状态描述字符串 (如 'teapot', 'invalid_params') */
  public status?: string;
  /** 额外的业务负载数据 */
  public data?: any;

  constructor(message: string, code: number = 500, status?: string, data?: any) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}
