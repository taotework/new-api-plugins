---
changelogVersion: 1
plugin: "telecomjs"
version: "1.0.0"
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 首个版本：接入江苏电信 AI 网关（aigw.telecomjs.com）的 Betydance 视频生成，走 `/v1/videos/generations`，覆盖 `doubao-seedance-2-5-betydance`、`doubao-seedance-2-0-260128-betydance`、`doubao-seedance-2-0-fast-260129-betydance` 和 `doubao-seedance-2-0-mini-260616-betydance` 四个模型。这些名字背后就是官方豆包 Seedance 系列。
- 支持文生视频、参考图、首尾帧和参考视频输入；生成的视频经网关从上游签名链接流式代理下载。
- 价格表只列出各模型支持的分辨率档位（2.5 最高 1080p；2.0 标准版最高 4k；fast/mini 最高 720p），选项带本地化标签。请求选择了模型不支持的档位（例如 `doubao-seedance-2-5-betydance` 请求 4k）时，提交即拒绝，不预留额度。
- 计费与官方 Seedance 价格表一致，参考视频（视频转视频）按官方单独费率计价。任务完成后按网关回报的真实 token 总量结算（其中包含音频成本），最终账单与实际消耗一致。
- 请求不指定时长时按网关默认时长计费：2.5 模型默认 10 秒，2.0 系模型默认 5 秒。不指定分辨率的请求按最高档（不超过 1080p）预留，任务完成后按实际交付分辨率结算。
- 支持用另一台 New API 作为上游：New API 渠道绑定本插件后，请求走上游网关上本插件自己的 `/telecomjs` 路由。

### Migration

- 为要启用的 Betydance 模型配置价格；计费使用与其他 Seedance 插件相同的用量表达式（`u("tokens")`、`u("resolution")`、`u("duration")`、`u("video_input")`），参考视频折扣同官方 doubao 模型一样通过 `u("video_input")` 条件设置。
- 需要支持插件 API v1 的网关构建（与 doubao 1.1.0 系列同一构建级别）；安装本插件前请先升级 new-api。
- 创建指向 `https://aigw.telecomjs.com` 的渠道并填入电信网关 API 密钥：专属 105 类型渠道会自动绑定本插件，也可以通过任务插件渠道的任务插件设置绑定。
- 要连接上游 New API，请在两端网关都启用本插件，并配置一个 New API 渠道填入上游地址和 API 密钥。
