# @isdk/tool-rpc 超时与流处理开发备忘录 (Development Log)

本文档记录了在实现 `timeout` 和 `expectedDuration` 规范过程中遇到的关键问题、误区及解决方案，旨在避免后续开发中重复犯错。

## 1. 超时竞态条件与 Buffer 机制 (Race Condition)

### 问题描述

当客户端和服务端使用完全相同的超时时间（如 500ms）时，由于网络延迟和计时器精度问题，客户端往往会在服务端发出 504 响应的同时或之前触发本地 `AbortController`。

- **后果**: 客户端抛出模糊的 `AbortError` (code 20)，而不是更有意义的服务端 `504 Gateway Timeout` 错误。

### 解决方案

- **规范建议**: 客户端的本地物理计时器必须比它发送给服务端的 `rpc-timeout` (逻辑超时) 稍长。
- **最佳实践**: 客户端本地超时 = `min(negotiated_timeout)` + `200ms` (Buffer)。这 200ms 专门预留给服务端产生 504 响应并通过网络传回客户端解析。

---

## 2. 工具函数的自包含性 (Self-Contained `func`)

### 问题描述

在测试中使用了外部定义的 `TextEncoder` 导致 `ReferenceError`。

- **原因**: `@isdk/tool-rpc` 支持 `allowExportFunc` 选项，这意味着 `ServerTools.func` 可能会被 `.toString()` 序列化后发送到客户端执行。
- **后果**: 任何闭包变量或非全局变量在序列化后都会丢失引用。

### 最佳实践

- **原则**: `func` 内部应保持**零闭包依赖**。
- **方案**: 所有必要的辅助对象（如 `TextEncoder`、`crypto` 等）应在 `func` 内部实例化，或者确保它们是环境全局可用的。

---

## 3. 流式检测的属性与方法 (Stream vs isStream)

### 问题描述

混淆了工具的“流能力标识”与“单次调用状态检查”。

- **误区**: 曾试图在元数据中使用 `isStream: true`，这覆盖了 `ToolFunc` 实例上的 `isStream(params)` 方法。

### 正确逻辑

- **`stream: true` (Metadata)**: 表示该工具“具备”返回流的能力。
- **`isStream(params)` (Method)**: 这是一个运行时检查方法，用于判断**当前这次调用**是否请求了流（通常检查 `params.stream === true`）。
- **注意**: 在 `RemoteToolFuncSchema` 中应注册 `stream` 属性，而不是 `isStream`。

---

## 4. 跨环境流兼容性 (Stream Compatibility)

### 问题描述

服务端只检查了 `result.pipe`，导致 Web 标准的 `ReadableStream` 被识别为普通 Object 并进行了 JSON 序列化。

- **原因**: Node.js 原生流有 `.pipe()`，但 Web 标准流没有。

### 解决方案

- **传输层要求**: 必须同时支持 Node.js Stream 和 Web ReadableStream。
- **实现**: 在服务端检测 `result instanceof ReadableStream`，并使用 `Readable.fromWeb(result).pipe(res)` 进行转换输出。

---

## 5. 参数透传 (Option Propagation)

### 问题描述

`ClientTools.run(params, options)` 的第二个参数 `options` 在早期版本中没有被正确传递给底层的 `fetch`。

- **后果**: 用户手动指定的 `{ timeout: 1000 }` 无效，系统回退到了默认的工具元数据超时。

### 解决方案

- **重写 `run`**: 在 `ClientTools` 中必须重写 `run` 方法，确保它调用 `this.func(params, options)`，并将 `options` 一路透传至 `transport.fetch`。

---

## 6. 错误码约定

### 504 vs 20 (AbortError)

- **504 (Gateway Timeout)**: 代表服务端执行超时，或者是客户端与服务端协商后的超时结果。这属于“预料之中”的业务超时。
- **AbortError (code 20)**: 代表由于客户端主动取消、页面卸载或客户端本地物理计时器（含 Buffer）到期导致的“硬中断”。
- **区分逻辑**: 开发者应优先处理 504 错误，它通常带有 `Execution Timeout` 的提示。
