---
changelogVersion: 1
plugin: "wasu"
version: "1.0.0"
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 通过 `/wasu/v1/video/generations` 路由或标准 OpenAI video / Responses 接口使用华数 Seedance 2.0 视频生成，支持文本、图片、首尾帧以及参考图片、参考视频、参考音频输入。
- 参考素材以 Seedance 风格的 `content` 数组放在 `metadata` 内发送；分辨率、宽高比等生成参数同样通过 `metadata` 传递，正是华数接口读取的位置。
- 任务轮询跟踪华数的状态值并显示进度百分比，完成后视频通过网关从查询响应中的签名链接提供服务。
- 计费采用官方 Seedance token 公式（秒 × 宽 × 高 × 24 / 1024），覆盖 480p、720p、1080p、4k 档位，并按模型档应用官方豆包 Seedance 价格表中的参考视频折扣。
