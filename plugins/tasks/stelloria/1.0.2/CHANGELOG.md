---
changelogVersion: 1
plugin: "stelloria"
version: "1.0.2"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.2]

### Added

- Generate videos with the Stelloria (星瞳) AI service through the `/stelloria/v1/videos/generations` routes or the standard OpenAI video and Responses surfaces.
- Seedance-style multimodal `content` input with the Stelloria material limits: up to 9 reference images, 3 reference videos, 3 reference audios, and one first plus one last frame.
- Wonder-Pro (Wonder Animation) support through its own dialect: a top-level PascalCase `Prompt` with duration, aspect ratio, resolution, and a single reference image.
- Billing uses the official Seedance token formula (seconds × width × height × 24 / 1024) across the 720p, 1080p, and 4k tiers for 5- or 10-second videos, with the reference-video discount on `doubao-seedance-2.0`.
- The finished video and its cover image are served through the gateway, and the completion overlay re-bills with the delivered duration and resolution.
