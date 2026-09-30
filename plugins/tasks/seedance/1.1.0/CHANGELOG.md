---
changelogVersion: 1
plugin: "seedance"
version: "1.1.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.1.0]

### Added

- Generate videos through the MaiCang gateway (channel type 101, `tipdance-*` models), the Stelloria gateway (channel type 102, `seedance-2.0` and `Wonder-Pro`), and the PGY relay (channel type 103, `pgy-seedance-2.0`), so one plugin now serves all five Seedance upstreams and the same client-facing model name can be mapped on any subset of those channels.
- The upstream dialect follows the channel's mapped model name: `tipdance-*` names use MaiCang's flat `images[]` format (one image = first frame, two images = first and last frame), `seedance-2.0` and `Wonder-Pro` use Stelloria's content format (Wonder-Pro with its PascalCase request shape and a single reference image), `pgy-*` uses PGY's Ark-style content format where the relay receives `doubao-seedance-2.0` unless the channel mapping overrides it.
- Stelloria tasks expose a cover image artifact next to the video, and PGY tasks expose a last-frame image; content download serves them by artifact key.
- PGY requests may state duration as a frames count, billed as frames / 24 seconds.

### Changed

- The reference-video discount now applies to Stelloria's `seedance-2.0` name (31/46 at 1080p and the other Seedance 2.0 tier rates): the standalone Stelloria plugin only discounted the `doubao-seedance-2.0` name, though both names run the same upstream model.
- Requests naming a resolution a Stelloria model does not offer, for example 480p on `seedance-2.0`, are rejected at submit before any quota is reserved, instead of being silently billed at 720p.
- Unrecognized poll statuses on the MaiCang, Stelloria, and PGY dialects now report UNKNOWN so the host counts them as consecutive poll failures; the standalone plugins silently reported IN_PROGRESS at 30%.

### Migration

- Price each mapped internal model name where channels serve the same client-facing model at different tiers (for example `doubao-seedance-2-5-betydance` against `doubao-seedance-2.0`); a price configured on the client-facing name takes precedence and overrides the per-tier prices, so leave the client-facing name unpriced when the tiers differ.
- Remove all five standalone Seedance plugins — MaiCang, Stelloria, PGY Seedance, and the Wasu and TelecomJS plugins named in 1.0.0 — from the gateway before installing this one: a gateway rejects a newly installed plugin whose channel types are already claimed. Channel types 101 through 105 then bind unambiguously to this plugin.
- Keep each channel's Base URL, key, and model mapping: `tipdance-*` names on MaiCang channels, `seedance-2.0` and `Wonder-Pro` on Stelloria channels, `pgy-*` names on PGY channels, `*-betydance` names on TelecomJS channels, and plain `doubao-seedance-2.0`, `-fast`, and `-mini` names on Wasu channels.
- Stelloria channels that mapped the name `doubao-seedance-2.0` must map `seedance-2.0` instead — the plain `doubao-seedance-*` names now select the Wasu dialect, and `seedance-2.0` is Stelloria's own alias of the same upstream model.
- For a New API channel that chains into another gateway, both ends of the chain must run this plugin; the chained path prefix is `/seedance` for every dialect, replacing the old `/maicang`, `/stelloria`, and `/pgy` prefixes.
