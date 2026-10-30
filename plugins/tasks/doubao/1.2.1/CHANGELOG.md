---
changelogVersion: 1
plugin: "doubao"
version: "1.2.1"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---
# Changelog

## [1.2.1]

### Added

- Generate and edit images with `doubao-seedream-5-0-flash-260915` through the native Doubao image route and the OpenAI Images API. Choose 1K, 1.5K, or 2K output and supply up to 10 reference images.
- Use Seedream 5.0 Flash for layer decomposition and transparent-background editing, with PNG or JPEG output. Layer decomposition requires exactly one input image; transparent output requires one reference image and PNG. Group generation is not supported by this model.

### Fixed

- Count actual returned images for Seedream models whose minimum output is above 1.5K, even when the response omits image sizes. Usage is reported in `images_above_1_5k` instead of retaining the requested count.
- Report `video_input: "none"` for Seedance models without reference-video support so existing usage-based prices continue to match their no-video condition.

### Migration

- Before installing, upgrade new-api to a build that supports preserving stored expressions when a model's usage profile narrows. See [usage profiles by model](../../../../docs/plugin-api/v1.md#usage-profiles-by-model).
