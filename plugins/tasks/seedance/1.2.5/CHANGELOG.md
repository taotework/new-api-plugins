---
changelogVersion: 1
plugin: "seedance"
version: "1.2.5"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.2.5]

### Fixed

- Stelloria requests now send the 5- or 10-second duration they are billed for. Before, a requested length other than 5 or 10 (for example 8) was forwarded as-is while the reservation counted 5 seconds, so the charge covered less video than the vendor could produce. Requests that omit the duration still leave the upstream default in place.
- PGY requests no longer forward a duration above 3600 seconds or a frames count above 86400 (the 3600-second ceiling at 24 frames per second). Both values are clamped to the limits the submit estimate already applies, so an out-of-range value cannot reach the relay.
- Numeric strings are now read as numbers wherever a duration is taken: `seconds` on the OpenAI video surface, and `duration` in a native Ark request, bill and forward exactly like the same value sent as a number.
