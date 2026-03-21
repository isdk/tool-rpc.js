import { getAllNames } from 'util-ex'
import { type ServerFuncParams, ServerTools } from "./server-tools";
import { type FuncParams, type FuncItem } from "@isdk/tool-func";
import { NotFoundError } from "@isdk/common-error";
import { ToolRpcContext } from "./transports/models";

export interface RpcMethodsServerFuncParams extends ServerFuncParams {
  act?: string
}

export interface RpcMethodsServerTool {
  methods: string[]
}

/**
 * RpcMethodsServerTool: 专门处理 Action (act) 分发的类
 */
export class RpcMethodsServerTool extends ServerTools {
  declare static SpecialRpcMethodNames?: string[]

  params: FuncParams = {
    'act': { type: 'string' },
  }

  get SpecialRpcMethodNames() {
    const ctor = this.constructor as unknown as RpcMethodsServerTool
    return ctor.SpecialRpcMethodNames
  }

  /**
   * 仅在 RpcMethods 类及其派生类中启用 Act 获取
   */
  getRpcAct(params: any, context?: ToolRpcContext): string | undefined {
    const ctx = context || this.ctx;
    return ctx?.act;
  }

  initRpcMethods(methods = this.methods) {
    const ActionNames = this.SpecialRpcMethodNames
    if (Array.isArray(ActionNames))
      for (const action of ActionNames) {
        if (typeof this[action] === 'function') {
          methods.push(action)
        }
      }
    getAllNames(Object.getPrototypeOf(this)).filter(name => name.startsWith('$') && typeof this[name] === 'function').forEach(name => {
      methods.push(name)
      const n = name.slice(1)
      if (this[n] === undefined) { this[n] = this[name] }
    })
  }

  constructor(name: string | Function | FuncItem, options: FuncItem | any = {}) {
    super(name, options)
    const methods = this.methods = [] as string[]
    this.initRpcMethods(methods)
  }

  cast(key: string, value: any, vType?: any) {
    if (!vType) {
      vType = this.params[key]
      if (vType && typeof vType !== 'string') {
        vType = vType.type as string
      }
    }
    if (vType) {
      value = castValue(value, vType)
    }
    return value
  }

  getMethodFromParams(params: RpcMethodsServerFuncParams, context?: ToolRpcContext) {
    return this.getRpcAct(params, context);
  }

  castParams(params: RpcMethodsServerFuncParams, context?: ToolRpcContext) {
    return params
  }

  func(params: RpcMethodsServerFuncParams, context?: ToolRpcContext) {
    const method = this.getMethodFromParams(params, context)

    if (method && typeof this[method] === 'function') {
      params = this.castParams(params, context)
      return this[method](params, context)
    } else {
      throw new NotFoundError(method!, this.name)
    }
  }
}

export const RpcMethodsServerToolSchema = {
  methods: {
    type: 'array',
  },
}

RpcMethodsServerTool.defineProperties(RpcMethodsServerTool, RpcMethodsServerToolSchema)

function castValue(value: any, vType?: any) {
  if (vType) {
    if (Array.isArray(vType)) {
      for (const t of vType) {
        try {
          value = castValue(value, t)
          break;
        } catch (e) { }
      }
    } else {
      if (vType === 'number') {
        value = Number(value)
      }
    }
  }
  return value
}
