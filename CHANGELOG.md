# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.0.0](https://github.com/isdk/tool-rpc.js/compare/v0.1.1...v1.0.0) (2026-07-05)


### Features

* add clientId to RPC_HEADERS and ToolRpcRequest ([92c62c7](https://github.com/isdk/tool-rpc.js/commit/92c62c7536db397ce1172e4a4adc69abc7dc9d9e))
* add Mailbox transport for asynchronous RPC ([803b20b](https://github.com/isdk/tool-rpc.js/commit/803b20b640d4c5008b339f0cc672c7bfab54f7a4))
* implement timeout mechanism and execution context support ([10827a8](https://github.com/isdk/tool-rpc.js/commit/10827a86c8a8527cea069a43ebb7988a91c9094d))
* **mailbox:** implement strict mode and mandatory req-id validation ([4b8e928](https://github.com/isdk/tool-rpc.js/commit/4b8e92893e29dbd524f4811581efb70f68e801b2))
* **transport-v2:** implement service connection pattern and on-demand binding ([eb20898](https://github.com/isdk/tool-rpc.js/commit/eb208987da4b175305275721fe436d8d687161b0))
* **transport:** refactor Mailbox transport to use mandatory Header-based routing ([f107d0b](https://github.com/isdk/tool-rpc.js/commit/f107d0bb18448b816d5d83f9e3cea2e1c5a94907))
* **transportsV2:** V2 Enhancements - Max Body Size, Background Guard, Shadow Instance Support ([3355ebf](https://github.com/isdk/tool-rpc.js/commit/3355ebf5d4bb8e2d6918e2566a1fc5314229dd17))
* **transportV2:** enhance core dispatcher and transport reliability ([852fb1b](https://github.com/isdk/tool-rpc.js/commit/852fb1b1a48a8c6f44c9f4aa3a93f7b6b70e6447))


### Bug Fixes

* avoid this.options is undefined ([9130d47](https://github.com/isdk/tool-rpc.js/commit/9130d473989be78043b503fe5fc797d7cf7cc7cc))
* **discovery:** isolate tool items in toJSON between server classes ([6991c53](https://github.com/isdk/tool-rpc.js/commit/6991c538d88922d0c5b5b2c38bbb136441e69e67))
* **ts:** make ts happy ([b77b77d](https://github.com/isdk/tool-rpc.js/commit/b77b77df8e62cc99f8b3726fce25504746d0025a))


### Refactor

* add transportsV2 ([d68b279](https://github.com/isdk/tool-rpc.js/commit/d68b279bd0c4bb491359368105b581472aa4a02a))
* export used Funcs ([9b268de](https://github.com/isdk/tool-rpc.js/commit/9b268deb8ad1534541533c6bb5bf809f02d7a635))
* final removal of old architecture and rename transportsV2 to transports ([cc2ca5b](https://github.com/isdk/tool-rpc.js/commit/cc2ca5b124fc9f0d4cf8bd75bb43bba9ce16a891))
* **mailbox:** improve transport reliability and lifecycle management ([0afac18](https://github.com/isdk/tool-rpc.js/commit/0afac18a341845e9f2537c8cea8ebb79f2d5bb41))
* standardize RPC header names across V1 and V2 transports ([2b2e316](https://github.com/isdk/tool-rpc.js/commit/2b2e316146a7608069266daa2185f9ec198e0062))
* standardize RPC header names and update documentation ([3994785](https://github.com/isdk/tool-rpc.js/commit/3994785494439c686d7721aaf13d3bbfd09eb8e5))
* **transportV2:** implement full task lifecycle visibility and flexible retention policies ([d8ba6ca](https://github.com/isdk/tool-rpc.js/commit/d8ba6ca5d839a6a2707073f73c618b0d59870596))
* **transportV2:** implement physical reuse and logical routing audit ([702ae74](https://github.com/isdk/tool-rpc.js/commit/702ae743396baa1501dc2e29f88ed50a23b200a9))
* **transportV2:** implement streaming lifecycle closure and enhance resource cleanup ([a22972a](https://github.com/isdk/tool-rpc.js/commit/a22972a1cb6473675fb530e9fad708cfed12dc82))
* **transportV2:** unify error handling philosophy and enhance execution deadlines ([341a569](https://github.com/isdk/tool-rpc.js/commit/341a569a8c3f03a135ddb7836cb8835969ea2b0e))

## 0.1.1 (2025-11-09)


### Bug Fixes

* **build:** update keywords ([81609ba](https://github.com/isdk/tool-rpc.js/commit/81609bad3a964a2fac3f5af9988bb6595bf337ea))


### Refactor

* **build:** export transports ([1c4d9fe](https://github.com/isdk/tool-rpc.js/commit/1c4d9feeb982e305e597719fcf1bcdf46906f1cb))
