---
changelogVersion: 1
plugin: "pgy-seedance"
version: "1.1.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---

# Changelog

## [1.1.0]

### Added

- Use another New API server as the upstream for PGY Seedance video generation: when a New API channel binds this plugin, its requests target this plugin's `/pgy` routes on the upstream gateway.
- Billing facts now include the requested `duration` in seconds, matching the sibling Seedance plugins, so billing expressions referencing duration no longer evaluate against a missing fact.

### Changed

- Resolution choices in the pricing table now show localized labels.
- Requests naming a resolution the model does not offer are rejected at submit before any quota is reserved; every Seedance 2.0 tier from 480p to 4k stays accepted.

### Migration

- Requires a gateway build that supports the updated plugin API; upgrade new-api before installing this version.
- To connect to an upstream New API server, enable the PGY Seedance plugin on both servers and configure a New API channel with the upstream address and API key.
