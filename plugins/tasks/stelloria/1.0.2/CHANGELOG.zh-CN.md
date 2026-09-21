---
changelogVersion: 1
plugin: "stelloria"
version: "1.0.2"
locale: "zh-CN"
---

# Changelog

## [1.0.2]

### Added

- 通过 `/stelloria/v1/videos/generations` 路由或标准 OpenAI video / Responses 接口使用星瞳 Stelloria AI 视频生成。
- 支持 Seedance 风格的 `content` 多模态输入，遵守星瞳素材上限：最多 9 张参考图、3 个参考视频、3 段参考音频，以及各一张首帧/尾帧。
- Wonder-Pro（Wonder Animation）以其自身方言接入：顶层 PascalCase `Prompt` 字段，配合时长、宽高比、分辨率和单张参考图。
- 计费采用官方 Seedance token 公式（秒 × 宽 × 高 × 24 / 1024），覆盖 720p、1080p、4k 档位（5 或 10 秒视频），`doubao-seedance-2.0` 享参考视频折扣。
- 生成的视频和封面图通过网关提供服务，完成时按实际交付的时长和分辨率重新结算。
