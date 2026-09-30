---
changelogVersion: 1
plugin: "seedance"
version: "1.2.0"
locale: "zh-CN"
---

# Changelog

## [1.2.0]

### Added

- 在现有路由之外，支持以火山官方请求格式调用本插件：经 `POST /seedance/api/v3/contents/generations/tasks` 提交、`GET /seedance/api/v3/contents/generations/tasks/:task_id` 轮询，响应为官方形态——提交返回 `{id, model, status}`，轮询返回任务对象（小写状态 `queued`/`running`/`succeeded`/`failed`、`content.video_url` 与 `content.last_frame_url`、`usage` 用量、上报时附带的实际分辨率与时长、失败时的 `error`）。两个表面共用同一任务仓库：任一表面提交的任务可在任一表面轮询。
- 官方表面接受完整的官方请求：`content` 数组的 `text`、`image_url`、`video_url`、`audio_url` 项及其角色（`first_frame`、`last_frame`、`reference_image`、`reference_video`、`reference_audio`），以及平铺的生成参数 `resolution`、`ratio`、`duration`、`generate_audio`、`seed`、`watermark`、`camera_fixed`、`return_last_frame`、`service_tier`、`callback_url`。各上游收到其网关支持的参数子集：华数与蒲公英整体透传，电信转发 resolution/duration/ratio/generate_audio/seed/watermark，星瞳转发其参数清单，麦仓携带 resolution/duration/generate_audio。
- 官方火山 SDK 客户端把 base URL 指到网关的 `/seedance` 路径即可——插件路由挂在插件 key 前缀下，与 doubao 插件的 `/doubao/api/v3/...` 同理。

### Changed

- 蒲公英请求现在同样会剔除空的蛇形命名 `service_tier` 参数（此前只处理 `serviceTier` 拼写），官方格式的请求不会再触发其中转的文生视频限制。
