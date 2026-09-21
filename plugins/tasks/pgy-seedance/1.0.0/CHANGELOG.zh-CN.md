---
changelogVersion: 1
plugin: "pgy-seedance"
version: "1.0.0"
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 通过 `/pgy/api/v3/contents/generations/tasks` 路由或标准 OpenAI video / Responses 接口，使用移动云豆包 Seedance 2.0 的蒲公英中继生成视频。
- 支持 Seedance content 数组方言的多模态输入：文本提示词、参考图片、首尾帧、参考视频和参考音频。
- 纯文生视频（t2v）请求的上游请求体中 `service_tier` 键保持缺失——移动云平台会拒绝携带该键的 t2v 请求（即使为空），因此仅在客户端提供非空值时才转发该字段。
- 计费采用官方 Seedance token 公式（秒 × 宽 × 高 × 24 / 1024），覆盖 480p、720p、1080p、4k 档位，并应用参考视频折扣。
- 生成的视频和尾帧图片通过网关以工件形式提供服务。
