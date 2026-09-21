---
changelogVersion: 1
plugin: "newapi-video"
version: "1.1.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.1.0]

### Added

- Relay video generation to another new-api instance's standard video API (`/v1/videos`): any model the upstream serves can be used through this gateway without per-vendor glue, including models with no dedicated plugin installed here.
- The client's model name goes through the channel's model mapping, so the upstream gateway receives the configured name.
- Billing reports the requested `duration`, `resolution`, and `video_input` facts using the official Seedance token formula for the estimate; when the upstream reports real usage (`usage` or `metadata.usage`), the final bill settles on those tokens, and delivered `seconds` and `size` recompute the estimate otherwise.
- Generated videos are streamed through the gateway from the upstream's `/v1/videos/{id}/content` endpoint.

### Changed

- The plugin no longer claims channel type 60: the New API channel type is reserved by the runtime, and a New API channel binds this relay through its task plugin setting instead.
- Resolution and reference-video choices in the pricing table now show localized labels.

### Migration

- Requires a gateway build that supports the updated plugin API; upgrade new-api before installing this version.
- Re-save the channels serving this relay so the New API channel binds this plugin through its task plugin setting; previously the channel type alone auto-bound it.
