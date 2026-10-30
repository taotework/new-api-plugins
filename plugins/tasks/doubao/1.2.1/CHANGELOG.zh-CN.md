---
changelogVersion: 1
plugin: "doubao"
version: "1.2.1"
locale: "zh-CN"
---
# Changelog

## [1.2.1]

### Added

- 新增 `doubao-seedream-5-0-flash-260915`，可通过豆包原生图片接口和 OpenAI Images API 生成、编辑图片，支持 1K、1.5K、2K 输出，最多传入 10 张参考图。
- Seedream 5.0 Flash 支持图层拆分、透明背景编辑，以及 PNG 或 JPEG 输出。图层拆分要求恰好一张输入图；透明输出要求一张参考图并使用 PNG。该模型不支持组图生成。

### Fixed

- 对最小输出尺寸高于 1.5K 的 Seedream 模型，即使响应未返回图片尺寸，也按实际返回的图片数量报告 `images_above_1_5k` 用量，不再沿用请求时的图片数量。
- 不支持参考视频的 Seedance 模型会报告 `video_input: "none"`，使已有的用量计费规则继续匹配无参考视频条件。

### Migration

- 安装前，将 new-api 升级至支持在模型用量 profile 收窄后保留已保存表达式的版本。详见[模型用量 profile](../../../../docs/plugin-api/v1.md#usage-profiles-by-model)。
