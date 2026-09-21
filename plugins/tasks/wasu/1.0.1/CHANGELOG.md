---
changelogVersion: 1
plugin: "wasu"
version: "1.0.1"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.1]

### Fixed

- Requests that leave the resolution to Wasu now bill the official 720p default tier; previously they were billed at 1080p, overcharging requests that relied on the documented default.
- Completed tasks now settle the final bill on the real token count reported by Wasu (`completion_tokens`, falling back to `total_tokens` when absent), and only successful polls contribute usage facts.
