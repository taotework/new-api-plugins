---
changelogVersion: 1
plugin: "seedance"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.0.0]

### Added

- Generate Doubao Seedance videos through the Wasu gateway (channel type 104) and the TelecomJS gateway (channel type 105) with a single plugin, so both upstreams can coexist on one gateway — including serving the same client-facing model name through different channels.
- The upstream dialect follows the channel's mapped model name: `*-betydance` models (`doubao-seedance-2-5-betydance`, `doubao-seedance-2-0-260128-betydance`, and the fast/mini betydance tiers) use the TelecomJS paths and request format, while plain `doubao-seedance-2.0`, `-fast`, and `-mini` names use the Wasu format.
- Both model families price with the official Seedance table: per-tier reference-video discounts, 4k support on the 2.0 standard tiers, submit-time rejection of resolutions the selected tier does not offer, and pricing tables that list only the resolutions each tier offers.
- TelecomJS tasks settle on completion to the gateway-reported token total, delivered resolution, and duration, and the 2.5 tier defaults to 10 seconds when a request omits duration; Wasu tasks, whose polls do not report the delivered resolution, bill the official 720p default tier when a request leaves the resolution to the upstream and settle the real token total on completion.
- Chain this plugin through another New API server: a New API channel bound to this plugin posts the plugin's uniform request shape to the `/seedance` native routes on the upstream gateway, which then rewrites the request for its own Wasu or TelecomJS channel.

### Migration

- Install this plugin on a gateway build that supports several channels sharing one plugin, and remove the separate Wasu and TelecomJS plugins from that gateway so channel types 104 and 105 bind unambiguously to this plugin.
- Keep each existing type-104 and type-105 channel's Base URL, key, and model mapping: map `*-betydance` names on TelecomJS channels and plain `doubao-seedance-2.0`, `-fast`, and `-mini` names on Wasu channels.
- For a New API channel that chains into another gateway, upgrade both ends of the chain to this plugin; the chained path prefix is `/seedance`, replacing the old `/wasu` and `/telecomjs` prefixes.
