---
changelogVersion: 1
plugin: "seedance"
version: "1.2.3"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.2.3]

### Added

- The Volcengine-native surface is now also reachable under the official Ark base-path spelling: `POST /seedance/api/v3/contents/generations/tasks` and its poll twin `GET /seedance/api/v3/contents/generations/tasks/{task_id}`, with the same request and response shapes as the existing `/seedance/v3/...` routes. A client written against the Ark SDK's default `/api/v3` base path only needs the gateway's `/seedance` prefix in front of it. The bare vendor path cannot exist on the gateway: `/api` is the gateway's reserved console namespace, which is why the official spelling rides under the plugin-key prefix like the built-in doubao plugin's `/doubao/api/v3` surface.
- The gateway-mapped public names `wux-dance-2-0`, `wux-dance-2-5`, `wux-dance-2-0-fast`, `wux-dance-2-0-mini`, `wux-dance-2-5-intl`, `wux-dance-2-0-intl`, `wux-dance-2-0-fast-intl` and `wux-dance-2-0-mini-intl` are now served on the plugin's native routes and listed on the model marketplace, each resolving to the resolutions and default duration of its price-table tier: the fast and mini names offer 480p/720p, the 2-5 names go up to 1080p with the 10-second default, and the 2-0 standard names go up to 4k.

### Fixed

- Submitting through a plugin native route with a gateway-mapped public model name (for example `wux-dance-2-0-mini` on `POST /seedance/v3/contents/generations/tasks`) was rejected before channel selection with `model ... is not served by this plugin`, because the claim check compared the public name against the plugin's declared upstream names. The declared model list now covers the public aliases, so the request proceeds into channel selection where the channel mapping translates the public name to its upstream model; the mapped upstream name keeps selecting the wire dialect and the billed tier at execution time.
