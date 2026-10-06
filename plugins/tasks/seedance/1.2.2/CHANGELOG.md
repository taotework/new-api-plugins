---
changelogVersion: 1
plugin: "seedance"
version: "1.2.2"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.2.2]

### Added

- The Volcengine-format submit endpoint (`POST /seedance/v3/contents/generations/tasks`) now accepts the flat request body `{model, prompt, images[]?}` as an alternative to the official `content` array, together with the same top-level parameters (`resolution`, `duration`, `ratio`, `aspect_ratio`, `seed`, `watermark`, `camera_fixed`, `generate_audio`, `return_last_frame`, `fps`, `frames`, `service_tier`, `callback_url`, plus the `seconds`/`size` spellings for duration/resolution). A simple client can create a task without building content items.
- The official text-embedded parameter spelling is now honored on the Volcengine-format submit endpoint: parameters written at the end of a content text item — `prompt --resolution 1080p --duration 5` — are treated like their top-level fields and removed from the prompt forwarded upstream. An explicit top-level field wins when both spellings are present. Recognized flags: `--resolution`/`--rs`, `--duration`, `--ratio`/`--ar`, `--aspect_ratio`, `--seed`, `--watermark`/`--wm`, `--camera_fixed`/`--camerafixed`, `--generate_audio`/`--generateaudio`, `--return_last_frame`/`--returnlastframe`, `--fps`/`--framespersecond`.

### Fixed

- Requests in the text-embedded parameter spelling were estimated and billed at the default tier (720p resolution, 5-second duration) and the flag text leaked into the prompt sent upstream; the parsed parameters now drive the reservation estimate, the pre-reservation resolution check, and the per-upstream request body, and the flags no longer travel with the prompt.
- `POST /v1/videos` ignored the OpenAI `seconds` field, so videos were generated at the default duration; `seconds` now maps to the duration. The endpoint also accepts the `ratio`/`aspect_ratio`, `seed` and `watermark` fields, and the prompt can arrive as Volcengine-style `content` text items.
- Volcengine-format poll responses now include the `created_at` and `updated_at` timestamps of the official task object.
- `GET /v1/videos` now reports the model carried by the stored upstream response when available, instead of an empty string.
