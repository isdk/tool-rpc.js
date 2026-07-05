[**@isdk/tool-rpc**](../README.md)

***

[@isdk/tool-rpc](../globals.md) / ToolRpcContext

# Interface: ToolRpcContext

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:135](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L135)

[V2 核心] 标准执行上下文接口

## Extends

- `ToolFuncContext`

## Indexable

> \[`key`: `string`\]: `any`

Allows users to extend arbitrary properties.

## Properties

### act?

> `optional` **act?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:143](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L143)

操作名称

***

### binding?

> `optional` **binding?**: `"early"` \| `"late"` \| `"auto"`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:125

The binding strategy for internal dependencies (runAsSync).
- 'early': Always use pre-bound instances from 'depends'.
- 'late': Always resolve from rootRegistry (forced polymorphism).
- 'auto': Use 'late' if rootRegistry shadows the dependency, else 'early' (Safe Default).

#### Inherited from

`ToolFuncContext.binding`

***

### dispatcher?

> `optional` **dispatcher?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:139](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L139)

***

### headers

> **headers**: `Record`\<`string`, `string` \| `number` \| `string`[] \| `undefined`\>

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:138](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L138)

***

### inheritContext?

> `optional` **inheritContext?**: `boolean`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:135

Whether to allow context inheritance/propagation in nested calls.
Defaults to true.

#### Inherited from

`ToolFuncContext.inheritContext`

***

### isolated?

> `optional` **isolated?**: `boolean`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:130

Whether to enable independent execution scope.
If true, a temporary instance will be created via Object.create(this) to isolate concurrency.

#### Inherited from

`ToolFuncContext.isolated`

***

### reply?

> `optional` **reply?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:147](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L147)

***

### req?

> `optional` **req?**: `any`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:146](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L146)

下方为协议底座元数据透传

***

### requestId

> **requestId**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:136](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L136)

***

### resId?

> `optional` **resId?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:141](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L141)

资源唯一标识

***

### rootRegistry?

> `optional` **rootRegistry?**: *typeof* `ToolFunc`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:118

The entry-point registry class that initiated the call chain.
Used for late-binding dependency resolution in hierarchical registries.

#### Inherited from

`ToolFuncContext.rootRegistry`

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: @isdk/ai-tools/packages/tool-func/dist/index.d.ts:139

Standard Web AbortSignal for propagating cancellation signals.

#### Inherited from

`ToolFuncContext.signal`

***

### traceId?

> `optional` **traceId?**: `string`

Defined in: [@isdk/ai-tools/packages/tool-rpc/src/transports/models.ts:137](https://github.com/isdk/tool-rpc.js/blob/9b268deb8ad1534541533c6bb5bf809f02d7a635/src/transports/models.ts#L137)
