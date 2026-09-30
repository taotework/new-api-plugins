---
changelogVersion: 1
plugin: "seedance"
version: "1.1.0"
locale: "zh-CN"
---

# Changelog

## [1.1.0]

### Added

- 接入麦仓网关（渠道类型 101，`tipdance-*` 模型）、星瞳网关（渠道类型 102，`seedance-2.0` 与 `Wonder-Pro`）和蒲公英中转（渠道类型 103，`pgy-seedance-2.0`），一个插件覆盖全部五条 Seedance 上游，同一个对外模型名可以映射到其中任意渠道组合。
- 上游方言由渠道映射后的模型名决定：`tipdance-*` 走麦仓的平铺 `images[]` 格式（单图=首帧、双图=首尾帧），`seedance-2.0` 与 `Wonder-Pro` 走星瞳的 content 格式（Wonder-Pro 用 PascalCase 请求体和单张参考图），`pgy-*` 走蒲公英的 Ark content 格式（映射未覆盖时上游收 `doubao-seedance-2.0`）。
- 星瞳任务在视频外提供封面图 artifact，蒲公英任务提供尾帧图 artifact；内容下载按 artifact key 分发。
- 蒲公英请求可以用帧数表达时长，按 帧数 / 24 秒计费。

### Changed

- 星瞳的 `seedance-2.0` 名现在同样享受参考视频折扣（1080p 档 31/46 等 Seedance 2.0 档位价）：独立星瞳插件此前只给 `doubao-seedance-2.0` 名打折，而两个名字跑的是同一个上游模型。
- 请求指定了星瞳模型不支持的分辨率（例如 `seedance-2.0` 上的 480p）时，在预留额度前的提交阶段即被拒绝，不再静默按 720p 计费。
- 麦仓、星瞳、蒲公英方言下无法识别的轮询状态现在返回 UNKNOWN，由宿主按连续轮询失败计数；独立插件此前静默按 30% 进度处理。

### Migration

- 同一对外模型名经不同渠道映射到不同档位时（如 `doubao-seedance-2-5-betydance` 对 `doubao-seedance-2.0`），按映射后的内部模型名分别配置价格：对外名上配置的价格优先级更高、会覆盖各档位价格，因此档位不同时不要在对外名上配统一价。
- 安装本插件前，先从网关移除全部五个独立 Seedance 插件（麦仓、星瞳、蒲公英，以及 1.0.0 已要求的华数与电信插件）——渠道类型已被已装插件占用时，网关会拒绝新装的插件；随后渠道类型 101 至 105 无歧义地绑定到本插件。
- 保留各渠道的 Base URL、密钥与模型映射：麦仓渠道映射 `tipdance-*` 名，星瞳渠道映射 `seedance-2.0` / `Wonder-Pro`，蒲公英渠道映射 `pgy-*` 名，电信渠道映射 `*-betydance` 名，华数渠道映射裸名 `doubao-seedance-2.0`、`-fast`、`-mini`。
- 之前把 `doubao-seedance-2.0` 映射到星瞳渠道的，请改映射为 `seedance-2.0`——裸 `doubao-seedance-*` 名现在选择华数方言，而 `seedance-2.0` 是星瞳对同一上游模型的自有别名。
- 级联到另一台网关的 New API 渠道，链路两端都要运行本插件；所有方言的级联路径前缀统一为 `/seedance`，替代原来的 `/maicang`、`/stelloria`、`/pgy` 前缀。
