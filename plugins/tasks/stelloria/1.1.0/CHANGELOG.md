---
changelogVersion: 1
plugin: "stelloria"
version: "1.1.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.1.0]

### Added

- Use another New API server as the upstream for Stelloria video generation: when a New API channel binds this plugin, its requests target this plugin's `/stelloria` routes on the upstream gateway.

### Changed

- The pricing table now separates the Seedance models from Wonder-Pro: reference-video pricing appears only for the Seedance models, and Wonder-Pro tasks no longer report a `video_input` fact — its single-image input never qualified for the discount.
- Resolution choices in the pricing table show localized labels, and requests naming a resolution outside the model's tier list are rejected at submit (all current models offer 720p, 1080p, and 4k).

### Fixed

- The completion overlay now applies the delivered resolution only when the poll body reports a tier the model offers; otherwise the submit-time estimate stands instead of silently re-billing at 720p.

### Migration

- Requires a gateway build that supports the updated plugin API; upgrade new-api before installing this version.
- To connect to an upstream New API server, enable the Stelloria plugin on both servers and configure a New API channel with the upstream address and API key.
