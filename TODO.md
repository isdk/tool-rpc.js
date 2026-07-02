# TODO - tool-rpc

## ClientTools 架构优化

- [ ] **优化 `ClientTools.connect` 的元数据复用**
  - **现状**: 目前 `connect` 创建子类并重置 `items = {}`，导致每个连接实例都需要重新执行 `loadFrom` 来填充工具桩（Stubs）。
  - **目标**: 所有的连接实例（BoundService）应当能够共享同一套工具定义（Metadata），仅在请求终点（`apiUrl`）和执行配置上保持独立。
  - **思路**:
    - 考虑使用类似 `with({apiUrl})` 的模式，利用原型链继承 `items`。
    - 确保工具实例在执行 `fetch` 时能够正确获取到所属子类/实例的 `apiUrl`。
    - 避免每个实例都执行一次 `loadFrom` 的远程获取过程。

- [ ] **增强 `loadFrom` 的灵活性**
  - 支持从已有的元数据（如父类的 `items`）同步定义，而不仅仅是通过网络 `fetch`。
