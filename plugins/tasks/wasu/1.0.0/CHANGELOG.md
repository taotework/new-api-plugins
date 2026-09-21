---
changelogVersion: 1
plugin: "wasu"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.0]

### Added

- Generate videos with the Wasu (华数) Seedance 2.0 service through the `/wasu/v1/video/generations` routes or the standard OpenAI video and Responses surfaces, using text, images, first/last frames, and reference image, video, or audio material.
- Reference material is sent in the Seedance-style `content` array inside `metadata`; output resolution, aspect ratio, and other generation parameters travel through `metadata`, exactly where the Wasu API reads them.
- Task polling tracks the Wasu status values with progress percentages, and the finished video is served through the gateway from the signed link in the poll response.
- Billing uses the official Seedance token formula (seconds × width × height × 24 / 1024) across the 480p, 720p, 1080p, and 4k tiers, with the reference-video discount from the official Doubao Seedance price table applied per model tier.
