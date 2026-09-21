---
changelogVersion: 1
plugin: "maicang"
version: "1.1.0"
locale: "zh-CN"
---

# Changelog

## [1.1.0]

### Added

- 支持用另一台 New API 作为麦仓视频生成的上游：New API 渠道绑定本插件后，请求走上游网关上本插件自己的 `/maicang` 路由。

### Changed

- 价格表现在只列出各 tipdance 档位支持的分辨率（tipdance-2-0 pro 支持 4k；tipdance-2-5 上限 1080p；fast/mini 上限 720p），每个分辨率选项都带本地化标签。
- 请求中指定的分辨率超出所选 tipdance 档位支持范围时（例如 `tipdance-2-0-fast` 请求 4k），提交时即拒绝，不再预留额度。

### Migration

- 需要支持新版插件 API 的网关构建；安装本版本前请先升级 new-api。
- 要连接上游 New API，请在两端网关都启用麦仓插件，并配置一个 New API 渠道填入上游地址和 API 密钥。
