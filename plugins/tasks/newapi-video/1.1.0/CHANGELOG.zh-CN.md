---
changelogVersion: 1
plugin: "newapi-video"
version: "1.1.0"
locale: "zh-CN"
---

# Changelog

## [1.1.0]

### Added

- 将视频生成透明中继到另一个 new-api 实例的标准视频接口（`/v1/videos`）：上游支持的任意模型都能经本网关调用，无需逐厂商适配，包括本地未安装专用插件的模型。
- 客户端的模型名会经过渠道 model mapping 转换，上游网关收到的是配置的名称。
- 计费按官方 Seedance token 公式上报请求的 `duration`、`resolution`、`video_input` 用量作为预估；上游上报真实用量（`usage` 或 `metadata.usage`）时按真实 token 结算，否则用交付的 `seconds` 和 `size` 重算预估。
- 生成的视频经网关从上游的 `/v1/videos/{id}/content` 接口流式代理。

### Changed

- 插件不再声明渠道类型 60：New API 渠道类型由运行时保留，New API 渠道改通过其任务插件设置绑定本中继。
- 价格表中的分辨率和参考视频选项现在带本地化标签。

### Migration

- 需要支持新版插件 API 的网关构建；安装本版本前请先升级 new-api。
- 请重新保存承载本中继的渠道，使 New API 渠道通过任务插件设置绑定本插件；此前仅凭渠道类型即可自动绑定。
