---
changelogVersion: 1
plugin: "seedance"
version: "1.2.1"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.2.1]

### Changed

- Pricing metadata on the public model marketplace now uses the same end-user wording as the Doubao plugin: the billing factors read "Billing token unit price", "Output video duration in seconds", "Output video resolution" and "Reference video input", and pricing samples read like "720p · 5s".

### Fixed

- Marketplace pricing pages no longer show the plugin's internal capability guide. Gateway-defined model names (channel mapping aliases such as `wux-dance-2-0`) resolve to the plugin's default pricing metadata, and that text used to mention upstream gateway families and internal model tier names; visitors of the marketplace now see end-user wording only.
