import { ToolRpcRequest, ToolRpcContext } from "./models";

export interface RpcCompatOptions {
    /** 是否开启参数桥接：允许从 params.id/act 自动填充到 Request 对象，以及反向映射 */
    enableParamBridge: boolean;
    /** 是否开启上下文注入：将 _req, _res 注入到 params 中供旧代码使用 */
    enableContextInjection: boolean;
}

export const DEFAULT_COMPAT_OPTIONS: RpcCompatOptions = {
    enableParamBridge: true,
    enableContextInjection: true,
};

/**
 * [向上提升] 将 V1 风格写在 Params 中的控制字段提升至 V2 Request 属性中
 */
export function elevateV1ParamsToV2Request(request: ToolRpcRequest) {
    if (request.params) {
        if (!request.resId && request.params.id !== undefined) {
            request.resId = String(request.params.id);
        }
        if (!request.act && request.params.act !== undefined) {
            request.act = String(request.params.act);
        }
    }
}

/**
 * [向下桥接] 将 V2 Request 属性回灌给 Params，使得依赖 params.id 的旧工具能正常工作
 */
export function bridgeV2RequestToV1Params(request: ToolRpcRequest, params: any) {
    if (params && typeof params === 'object') {
        if (request.resId !== undefined && params.id === undefined) {
            params.id = request.resId;
        }
        if (request.act !== undefined && params.act === undefined) {
            params.act = request.act;
        }
    }
    return params;
}

/**
 * [向下桥接] 将 Context 信息回灌给 Params
 */
export function bridgeContextToV1Params(context: ToolRpcContext, params: any) {
    if (params && typeof params === 'object') {
        if (context.resId !== undefined && params.id === undefined) {
            params.id = context.resId;
        }
        if (context.act !== undefined && params.act === undefined) {
            params.act = context.act;
        }
    }
    return params;
}

/**
 * 将底座原生对象注入到 params 内部供遗留代码提取 (如使用 _req)
 */
export function injectV1ContextToParams(params: any, context: ToolRpcContext) {
    if (params && typeof params === 'object') {
        if (context.req && params._req === undefined) params._req = context.req;
        if (context.reply && params._res === undefined) params._res = context.reply;
        if (context.signal && params._signal === undefined) params._signal = context.signal;
    }
}
