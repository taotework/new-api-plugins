---
changelogVersion: 1
plugin: "pgy-seedance"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.0]

### Added

- Generate videos with the PGY relay of China Mobile Cloud's Doubao Seedance 2.0 API through the `/pgy/api/v3/contents/generations/tasks` routes or the standard OpenAI video and Responses surfaces.
- Multimodal input in the Seedance content-array dialect: text prompts, reference images, first/last frames, reference video, and reference audio.
- Pure text-to-video requests keep the `service_tier` key absent from the upstream body — the Mobile Cloud platform rejects t2v requests that carry it even when empty, so the field is forwarded only when the client supplies a non-empty value.
- Billing uses the official Seedance token formula (seconds × width × height × 24 / 1024) across the 480p, 720p, 1080p, and 4k tiers, with the reference-video discount.
- The generated video and the delivered last frame are served through the gateway as artifacts.
