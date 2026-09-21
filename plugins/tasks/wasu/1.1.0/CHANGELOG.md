---
changelogVersion: 1
plugin: "wasu"
version: "1.1.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.1.0]

### Added

- Use another New API server as the upstream for Wasu video generation: when a New API channel binds this plugin, its requests target this plugin's `/wasu` routes on the upstream gateway.

### Changed

- The pricing table now lists only the resolution tiers each model offers (`doubao-seedance-2.0` up to 4k; fast and mini up to 720p), with localized labels for each resolution choice.
- Requests naming a resolution the selected model tier does not offer, for example 4k on `doubao-seedance-2.0-fast`, are now rejected at submit before any quota is reserved.

### Migration

- Requires a gateway build that supports the updated plugin API; upgrade new-api before installing this version.
- To connect to an upstream New API server, enable the Wasu plugin on both servers and configure a New API channel with the upstream address and API key.
