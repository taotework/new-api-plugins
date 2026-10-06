---
changelogVersion: 1
plugin: "seedance"
version: "1.2.2"
locale: "zh-CN"
translations:
  en: "CHANGELOG.md"
---

# 更新日志

## [1.2.2]

### Added

- 火山方舟格式提交接口（`POST /seedance/v3/contents/generations/tasks`）现接受平铺请求体 `{model, prompt, images[]?}` 作为官方 `content` 数组的替代写法，可同时携带与官方相同的顶层参数（`resolution`、`duration`、`ratio`、`aspect_ratio`、`seed`、`watermark`、`camera_fixed`、`generate_audio`、`return_last_frame`、`fps`、`frames`、`service_tier`、`callback_url`，以及时长/分辨率的 `seconds`/`size` 写法）。简单客户端无需拼装 content 数组即可创建任务。
- 官方的文本内嵌参数写法现已在火山方舟格式提交接口上生效：写在 content 文本项末尾的参数——`提示词 --resolution 1080p --duration 5`——与对应顶层字段同等对待，并从转发给上游的提示词中移除。两种写法同时出现时，顶层字段优先。可识别的参数：`--resolution`/`--rs`、`--duration`、`--ratio`/`--ar`、`--aspect_ratio`、`--seed`、`--watermark`/`--wm`、`--camera_fixed`/`--camerafixed`、`--generate_audio`/`--generateaudio`、`--return_last_frame`/`--returnlastframe`、`--fps`/`--framespersecond`。

### Fixed

- 使用文本内嵌参数写法的请求此前按默认档位（720p 分辨率、5 秒时长）预估计费，且参数文本会混入发送给上游的提示词；现在解析出的参数会正确驱动预留估价、预留前的分辨率校验和按方言转发的上游请求体，参数文本不再随提示词透传。
- `POST /v1/videos` 此前忽略 OpenAI 标准的 `seconds` 字段，视频按默认时长生成；现在 `seconds` 正确映射为时长。该端点同时接受 `ratio`/`aspect_ratio`、`seed` 与 `watermark` 字段，提示词也支持以火山方舟风格的 `content` 文本项传入。
- 火山方舟格式的轮询响应现包含官方任务对象的 `created_at` 与 `updated_at` 时间戳。
- `GET /v1/videos` 在存储的上游响应携带模型名时会正确回显，不再返回空字符串。
