---
changelogVersion: 1
plugin: "telecomjs"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.0]

### Added

- Initial release: TelecomJS (Jiangsu Telecom AI gateway, `aigw.telecomjs.com`) Betydance video generation through `/v1/videos/generations`, covering the `doubao-seedance-2-5-betydance`, `doubao-seedance-2-0-260128-betydance`, `doubao-seedance-2-0-fast-260129-betydance` and `doubao-seedance-2-0-mini-260616-betydance` models. The gateway serves the official Doubao Seedance family behind these names.
- Text, reference image, first/last frame, and reference video input are supported; the generated video is streamed through the gateway from the upstream's signed link.
- The pricing table lists only the resolution tiers each model offers (2.5 up to 1080p; 2.0 standard up to 4k; fast and mini up to 720p), with localized labels. Requests naming a tier the model does not offer, for example 4k on `doubao-seedance-2-5-betydance`, are rejected at submit before any quota is reserved.
- Billing follows the official Seedance price table, including the separate reference-video (video-to-video) rates. Completed tasks settle on the gateway-reported token total, which includes audio cost, so the final bill matches real consumption.
- Requests that omit the duration bill the gateway default: 10 seconds on the 2.5 model, 5 seconds on the 2.0 models. Requests that leave the resolution to the upstream reserve the model's highest tier up to 1080p and settle on the delivered resolution once the task completes.
- Supports using another New API server as the upstream: when a New API channel binds this plugin, its requests target this plugin's `/telecomjs` routes on the upstream gateway.

### Migration

- Configure prices for the Betydance models you enable; billing uses the Seedance usage expressions (`u("tokens")`, `u("resolution")`, `u("duration")`, `u("video_input")`) like the other Seedance plugins. Price the reference-video discount with the `u("video_input")` condition as on the official doubao models.
- Requires a gateway build that supports the plugin API v1 (the same build level as the doubao 1.1.0 line); upgrade new-api before installing this plugin.
- Create a channel pointing at `https://aigw.telecomjs.com` with your TelecomJS API key: a dedicated type-105 channel auto-binds this plugin, or bind it through a task-plugin channel's task plugin setting.
- To connect to an upstream New API server, enable the TelecomJS plugin on both servers and configure a New API channel with the upstream address and API key.
