---
changelogVersion: 1
plugin: "seedance"
version: "1.2.0"
locale: "zh-CN"
---

# Changelog

## [1.2.0]

### Added

- 在现有路由之外，支持以火山官方请求格式调用本插件：经 `POST /seedance/v3/contents/generations/tasks` 提交、`GET /seedance/v3/contents/generations/tasks/:task_id` 轮询，响应为官方形态——提交返回 `{id, model, status}`，轮询返回任务对象（小写状态 `queued`/`running`/`succeeded`/`failed`、`content.video_url` 与 `content.last_frame_url`、`usage` 用量、上报时附带的实际分辨率与时长、失败时的 `error`）。两个表面共用同一任务仓库：任一表面提交的任务可在任一表面轮询。
- 官方表面接受完整的官方请求：`content` 数组的 `text`、`image_url`、`video_url`、`audio_url` 项及其角色（`first_frame`、`last_frame`、`reference_image`、`reference_video`、`reference_audio`），以及平铺的生成参数 `resolution`、`ratio`、`duration`、`generate_audio`、`seed`、`watermark`、`camera_fixed`、`return_last_frame`、`service_tier`、`callback_url`。各上游收到其网关支持的参数子集：华数与蒲公英整体透传，电信转发 resolution/duration/ratio/generate_audio/seed/watermark，星瞳转发其参数清单，麦仓携带 resolution/duration/generate_audio。
- 官方火山 SDK 客户端把 base URL 指到网关的 `/seedance/v3` 路径即可——官方表面挂在插件 key 前缀下但去掉了 `api/` 段，SDK 的 `/contents/generations/tasks` 等路径会解析到 `/seedance/v3/contents/generations/tasks`。

- 执行渠道的线路方言现在优先按宿主提供的 `ctx.channelType` 选择（101–105 对应麦仓、星瞳、蒲公英、华数、江苏电信），渠道服务其厂商名族之外的模型名时，提交与轮询仍使用该渠道自己的协议；无渠道身份的场景（旧宿主、通用 Task Plugin 渠道、New API 链式渠道）保持按模型名族兜底。`ctx.channelId` 仅网关内有效，不持久化。

### Changed

- 蒲公英请求现在同样会剔除空的蛇形命名 `service_tier` 参数（此前只处理 `serviceTier` 拼写），官方格式的请求不会再触发其中转的文生视频限制。
