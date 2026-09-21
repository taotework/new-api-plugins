---
changelogVersion: 1
plugin: "pgy-seedance"
version: "1.1.0"
locale: "zh-CN"
---

# Changelog

## [1.1.0]

### Added

- 支持用另一台 New API 作为蒲公英 Seedance 视频生成的上游：New API 渠道绑定本插件后，请求走上游网关上本插件自己的 `/pgy` 路由。
- 计费用量现在包含请求的 `duration`（秒），与同族 Seedance 插件一致，引用 duration 的计费表达式不再因缺失该值而出错。

### Changed

- 价格表中的分辨率选项现在带本地化标签。
- 请求指定的分辨率超出模型支持范围时，提交时即拒绝，不再预留额度；Seedance 2.0 的 480p–4k 各档位均保持可用。

### Migration

- 需要支持新版插件 API 的网关构建；安装本版本前请先升级 new-api。
- 要连接上游 New API，请在两端网关都启用蒲公英 Seedance 插件，并配置一个 New API 渠道填入上游地址和 API 密钥。
