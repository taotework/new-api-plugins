---
changelogVersion: 1
plugin: "seedance"
version: "1.2.3"
locale: "zh-CN"
---

# 更新日志

## [1.2.3]

### Added

- 火山方舟原生接口现在同时提供官方 base-path 拼写：`POST /seedance/api/v3/contents/generations/tasks` 及其查询孪生 `GET /seedance/api/v3/contents/generations/tasks/{task_id}`，请求与响应形状与既有 `/seedance/v3/...` 路由完全一致。按 Ark SDK 默认 `/api/v3` 基础路径编写的客户端只需在前面加上网关的 `/seedance` 前缀。裸的厂商路径在网关上无法存在：`/api` 是网关保留的控制台命名空间，所以官方拼写挂在插件键前缀之下，与内置 doubao 插件的 `/doubao/api/v3` 接口同构。
- 网关映射的公开模型名 `wux-dance-2-0`、`wux-dance-2-5`、`wux-dance-2-0-fast`、`wux-dance-2-0-mini`、`wux-dance-2-5-intl`、`wux-dance-2-0-intl`、`wux-dance-2-0-fast-intl`、`wux-dance-2-0-mini-intl` 现在可在插件原生路由上调用，并展示在模型广场，各自按其价格表档位解析分辨率与默认时长：fast/mini 档提供 480p/720p，2.5 档最高 1080p（默认 10 秒），2.0 标准档最高 4k。

### Fixed

- 通过插件原生路由以网关映射的公开模型名提交任务（例如在 `POST /seedance/v3/contents/generations/tasks` 上使用 `wux-dance-2-0-mini`）时，会在渠道选择之前被 `model ... is not served by this plugin` 拒绝，原因是认领检查拿公开名与插件声明的上游模型名比对。声明的模型列表现已覆盖公开别名，请求可以继续进入渠道选择，由渠道映射把公开名翻译成上游模型；执行时的线路方言与计费档位仍由映射后的上游模型名决定。
