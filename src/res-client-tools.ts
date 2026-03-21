import { RpcMethodsClientFuncParams, RpcMethodsClientTool } from "./rpc-methods-client-tool";
import { throwError } from "@isdk/common-error";
import type { ActionName } from "./consts";

export interface ResClientFuncParams extends RpcMethodsClientFuncParams {
  id?: string | number
}

export interface ResClientTools {
  get?({ id }: ResClientFuncParams): any
  post?(options: ResClientFuncParams): any
  put?({ id }: ResClientFuncParams): any
  delete?({ id }: ResClientFuncParams): any
  list?(options?: ResClientFuncParams): any
}

export class ResClientTools extends RpcMethodsClientTool {
  async fetch(options: ResClientFuncParams, action: ActionName, ...args: any[]) {
    if (!options) { options = {} as any }
    if (action && this.action === 'res') {
      if (action === 'get' || action === 'delete' || action === 'put') {
        let id = options.id
        if (id !== undefined) {
          // id = JSON.stringify(id)
          delete options.id
          return super.fetch(options, action, id)
        }
      }
    }
    return await super.fetch(options, action, ...args)
  }
}
