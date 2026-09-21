---
changelogVersion: 1
plugin: "maicang"
version: "1.0.1"
locale: "zh-CN"
---

# Changelog

## [1.0.1]

### Fixed

- 任务完成后按麦仓上报的真实 token 数（`completion_tokens`，缺失时回退 `total_tokens`）结算最终账单，不再保留提交时的预估值。
- 未指定分辨率的请求现在按官方 720p 默认档计费；此前按 1080p 计费，多收了依赖官方默认档的请求。
