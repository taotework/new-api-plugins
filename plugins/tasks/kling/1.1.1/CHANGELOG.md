---
changelogVersion: 1
plugin: "kling"
version: "1.1.1"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---
# Changelog

## [1.1.1]

### Fixed

- Accept a single API key issued by Kling for video submission and status queries.
- Trim surrounding whitespace from credentials before authentication and reject blank keys with a clear error.
