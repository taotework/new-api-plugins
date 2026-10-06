---
changelogVersion: 1
plugin: "seedance"
version: "1.2.4"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.2.4]

### Fixed

- Task responses on the native and Ark surfaces now echo the model name the customer sent (for example `wux-dance-2-0-mini`) instead of the channel-mapped internal upstream name (for example `doubao-seedance-2-0-mini-260616-betydance`), so a renamed public model no longer reveals the original upstream identity in `model` fields. Affects the submit and poll responses of `/seedance/v1/video/generations`, `/seedance/v3/contents/generations/tasks` and `/seedance/api/v3/contents/generations/tasks`; the OpenAI `/v1/videos` surface already echoed the public name. Polling responses for tasks created before this version keep the previous behavior when the gateway has no recorded public name.

### Migration

- The fixed echo takes effect only on gateway builds that expose the task's public model name in the plugin task view (`dto.TaskView.Model`). Deploy such a build together with this version; until then the rendered `model` fields show the same content as 1.2.3.
