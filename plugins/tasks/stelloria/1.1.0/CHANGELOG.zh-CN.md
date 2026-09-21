---
changelogVersion: 1
plugin: "stelloria"
version: "1.1.0"
locale: "zh-CN"
---

# Changelog

## [1.1.0]

### Added

- 支持用另一台 New API 作为星瞳视频生成的上游：New API 渠道绑定本插件后，请求走上游网关上本插件自己的 `/stelloria` 路由。

### Changed

- 价格表现在把 Seedance 系模型与 Wonder-Pro 分开：参考视频计价只出现在 Seedance 系模型上，Wonder-Pro 任务不再上报 `video_input` 用量——其单图输入本来就不享受该折扣。
- 价格表中的分辨率选项带本地化标签；请求指定的分辨率超出模型档位清单时提交即拒绝（当前所有模型均支持 720p、1080p、4k）。

### Fixed

- 完成结算只在轮询响应上报了模型支持的档位时才覆盖分辨率；否则保留提交时的预估，不再悄悄按 720p 重算。

### Migration

- 需要支持新版插件 API 的网关构建；安装本版本前请先升级 new-api。
- 要连接上游 New API，请在两端网关都启用星瞳插件，并配置一个 New API 渠道填入上游地址和 API 密钥。
