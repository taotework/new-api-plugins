---
changelogVersion: 1
plugin: "seedance"
version: "1.0.0"
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 用一个插件同时接入华数网关（渠道类型 104）与江苏电信网关（渠道类型 105）生成豆包 Seedance 视频，两条上游可以在同一网关并存——包括用不同的渠道服务同一个对外模型名。
- 上游方言由渠道映射后的模型名决定：`*-betydance` 模型（`doubao-seedance-2-5-betydance`、`doubao-seedance-2-0-260128-betydance` 及 fast/mini betydance 档）走电信的接口路径与请求格式，裸名 `doubao-seedance-2.0`、`-fast`、`-mini` 走华数格式。
- 两个模型家族都按官方 Seedance 价格表计费：按档位的参考视频折扣、2.0 标准档支持 4k、提交时拒绝该档不支持的分辨率，定价表只列出各档实际提供的分辨率。
- 电信任务完成时按网关回报的真实 token 总量、实际交付分辨率与时长结算，2.5 档不传时长默认 10 秒；华数上游的轮询不回报实际分辨率，不指定分辨率的请求按官方 720p 默认档计费，完成时覆盖真实 token 总量。
- 支持经另一台 New API 服务器级联：绑定本插件的 New API 渠道会把插件统一的请求形态发到上游网关的 `/seedance` 原生路由，由上游网关再按它自己的华数或电信渠道改写。

### Migration

- 在支持多渠道共享同一插件的网关版本上安装本插件，并从该网关移除独立的 Wasu 与 TelecomJS 插件，使渠道类型 104 和 105 无歧义地绑定到本插件。
- 保留每个 104/105 渠道的 Base URL、密钥与模型映射：电信渠道上映射 `*-betydance` 名，华数渠道上映射裸名 `doubao-seedance-2.0`、`-fast`、`-mini`。
- 级联到另一台网关的 New API 渠道，链路两端都要升级到本插件；级联路径前缀为 `/seedance`，替代原来的 `/wasu` 与 `/telecomjs` 前缀。
