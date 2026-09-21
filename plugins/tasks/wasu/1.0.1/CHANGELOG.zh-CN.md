---
changelogVersion: 1
plugin: "wasu"
version: "1.0.1"
locale: "zh-CN"
---

# Changelog

## [1.0.1]

### Fixed

- 未指定分辨率的请求现在按官方 720p 默认档计费；此前按 1080p 计费，多收了依赖官方默认档的请求。
- 任务完成后按华数上报的真实 token 数（`completion_tokens`，缺失时回退 `total_tokens`）结算最终账单，且只有成功的轮询才计入用量。
