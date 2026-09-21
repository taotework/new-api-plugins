---
changelogVersion: 1
plugin: "pgy-seedance"
version: "1.0.1"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.1]

### Fixed

- Requests that leave the resolution to the upstream now bill the official 720p default tier; previously they were billed at 1080p, overcharging requests that relied on the documented default.
- The 4k tier is now recognized in the submit estimate and the completion overlay; the pricing tables already covered it, but the tier recognition lists missed it.
- Requests omitting duration, seconds, and frames now bill the official 5-second default; previously they were billed at 15 seconds, a 3x overestimate that stuck on duration-based billing expressions.
