---
changelogVersion: 1
plugin: "seedance"
version: "1.2.4"
locale: "zh-CN"
---

# 更新日志

## [1.2.4]

### Fixed

- 原生与 Ark 接口的任务响应现在回显客户请求时使用的模型名（例如 `wux-dance-2-0-mini`），不再回显渠道映射后的内部上游名（例如 `doubao-seedance-2-0-mini-260616-betydance`），公开模型改名后不会再在 `model` 字段中泄露原上游身份。覆盖 `/seedance/v1/video/generations`、`/seedance/v3/contents/generations/tasks`、`/seedance/api/v3/contents/generations/tasks` 的提交与查询响应；OpenAI `/v1/videos` 接口本就回显公开名。本版本之前创建的任务，在网关没有记录公开名时查询响应保持原有行为。

### Migration

- 回显修复仅在插件任务视图携带任务公开模型名的网关构建上生效（`dto.TaskView.Model`）。请将此类构建与本版本一同部署；在此之前渲染出的 `model` 字段与 1.2.3 一致。
