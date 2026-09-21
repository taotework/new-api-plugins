---
changelogVersion: 1
plugin: "maicang"
version: "1.0.1"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.1]

### Fixed

- Completed tasks now settle the final bill on the real token count reported by MaiCang (`completion_tokens`, falling back to `total_tokens` when absent) instead of keeping the submit-time estimate.
- Requests that leave the resolution to MaiCang now bill the official 720p default tier; previously they were billed at 1080p, overcharging requests that relied on the documented default.
