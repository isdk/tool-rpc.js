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
};

/**
 * 状态码语义对照表
 */
export enum RpcStatusCode {
  OK = 200,               // 成功
  PROCESSING = 102,       // 任务挂起，仍在后台处理
  BAD_REQUEST = 400,      // 参数/协议能力错误
  NOT_FOUND = 404,        // 找不到工具或资源
  TERMINATED = 408,       // 硬超时终止
  INTERNAL_ERROR = 500,   // 执行错误
  GATEWAY_TIMEOUT = 504,  // 没能来得及进入保持状态的超时
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
  status: number;
  data?: any;
  headers?: Record<string, string | number | string[] | undefined>;
  error?: {
    code: number;
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
  public status: number;
  public code: number;
  public data?: any;

  constructor(message: string, status: number = 500, code?: number, data?: any) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
    this.code = code || status;
    this.data = data;
  }
}
