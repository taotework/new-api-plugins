---
changelogVersion: 1
plugin: "maicang"
version: "1.1.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.1.0]

### Added

- Use another New API server as the upstream for MaiCang video generation: when a New API channel binds this plugin, its requests target this plugin's `/maicang` routes on the upstream gateway.

### Changed

- The pricing table now lists only the resolution tiers each tipdance tier offers (tipdance-2-0 pro up to 4k; tipdance-2-5 up to 1080p; fast and mini up to 720p), with localized labels for each resolution choice.
- Requests naming a resolution the selected tipdance tier does not offer, for example 4k on `tipdance-2-0-fast`, are now rejected at submit before any quota is reserved.

### Migration

- Requires a gateway build that supports the updated plugin API; upgrade new-api before installing this version.
- To connect to an upstream New API server, enable the MaiCang plugin on both servers and configure a New API channel with the upstream address and API key.
