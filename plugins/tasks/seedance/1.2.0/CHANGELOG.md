---
changelogVersion: 1
plugin: "seedance"
version: "1.2.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.2.0]

### Added

- Call the plugin in the official Volcengine request format, alongside the existing routes: submit via `POST /seedance/v3/contents/generations/tasks` and poll via `GET /seedance/v3/contents/generations/tasks/:task_id`, with the official response shapes — `{id, model, status}` on submit, and on poll the task object with lowercase statuses (`queued`/`running`/`succeeded`/`failed`), `content.video_url` and `content.last_frame_url`, `usage` tokens, the delivered resolution and duration when reported, and `error` on failure. Both surfaces share one task store: a task submitted through either route polls through either.
- The official surface accepts the full official request: the `content` array with `text`, `image_url`, `video_url`, and `audio_url` items and their roles (`first_frame`, `last_frame`, `reference_image`, `reference_video`, `reference_audio`), and the flat generation parameters `resolution`, `ratio`, `duration`, `generate_audio`, `seed`, `watermark`, `camera_fixed`, `return_last_frame`, `service_tier`, and `callback_url`. Each upstream receives the parameters its gateway supports: Wasu and PGY carry the parameter set through, TelecomJS forwards resolution, duration, ratio, generate_audio, seed, and watermark, Stelloria forwards its parameter list, and MaiCang carries resolution, duration, and generate_audio.
- Official Volcengine SDK clients point their base URL at the gateway's `/seedance/v3` path — the official surface is namespaced under the plugin key without the extra `api/` segment, so SDK paths like `/contents/generations/tasks` resolve to `/seedance/v3/contents/generations/tasks`.

- The wire dialect of the executing channel is now selected by its channel type when the host provides `ctx.channelType` (101–105 map to MaiCang, Stelloria, PGY, Wasu and TelecomJS), so a channel serving model names outside its vendor family still speaks its own protocol during submission and polling; hosts without channel identity (older hosts, generic Task Plugin channels, New API chain channels) keep the model-name family fallback. `ctx.channelId` is gateway-internal and is never persisted.

### Changed

- PGY requests now also strip an empty snake_case `service_tier` parameter (previously only the `serviceTier` spelling), so official-format requests cannot trip the relay's text-to-video restriction.
