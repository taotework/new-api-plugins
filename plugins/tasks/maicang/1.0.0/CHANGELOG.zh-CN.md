---
changelogVersion: 1
plugin: "maicang"
version: "1.0.0"
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 通过 `/maicang/v1/video/generations` 路由或标准 OpenAI video / Responses 接口使用麦仓视频生成，支持 tipdance 系模型（含 `-intl`/`-inel` 国际版变体）。
- 图片输入接受单图（作为首帧）或两图（首帧 + 尾帧）；图片可以是纯 URL、`{url}`/`{image_url:{url}}` 对象或 content 数组项，统一规范化为麦仓接口要求的 `{url:"…"}` 对象。
- 客户端提供 `generate_audio` 和时长（`duration` 或 `seconds`）参数时会转发给上游。
- 计费采用官方 Seedance token 公式（秒 × 宽 × 高 × 24 / 1024），覆盖 480p、720p、1080p、4k 档位，并按 tipdance 档位应用官方豆包 Seedance 价格表中的参考视频折扣。
- 网关虚拟模型名（`wux-dance-*`）通过任务插件渠道的 model mapping 提供；插件本身声明 tipdance-* 具体名称。
