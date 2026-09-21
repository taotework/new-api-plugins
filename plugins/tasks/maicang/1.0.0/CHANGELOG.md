---
changelogVersion: 1
plugin: "maicang"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.0]

### Added

- Generate videos with the MaiCang (麦仓) relay through the `/maicang/v1/video/generations` routes or the standard OpenAI video and Responses surfaces, using the tipdance model family including the international (`-intl`, `-inel`) variants.
- Image input accepts a single image (used as the first frame) or two images (first and last frame); images may be plain URLs, `{url}` or `{image_url:{url}}` objects, or content-array items, and are normalized to the `{url:"…"}` objects the MaiCang API expects.
- Optional `generate_audio` and duration (`duration` or `seconds`) parameters are forwarded to the upstream when the client supplies them.
- Billing uses the official Seedance token formula (seconds × width × height × 24 / 1024) across the 480p, 720p, 1080p, and 4k tiers, with the reference-video discount from the official Doubao Seedance price table applied per tipdance tier.
- Virtual gateway model names (`wux-dance-*`) are served through a Task Plugin channel's model mapping; the plugin itself claims the concrete tipdance-* names.
