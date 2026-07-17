# Changelog

Changes that affect users or maintainers are recorded here. Release-specific
notes live under [`docs/releases/`](docs/releases/).

## Unreleased

## 0.2.3

- Added native drag-and-drop CSV upload feedback and corrected account-scoped
  activity conversion and mapping persistence.
- Removed the release self-attestation artifact; release publication now relies
  on reproducible public validation and package checks.

## 0.2.2

- Restored the runtime sidebar entry and `/addon/revolut-importer` route
  required by the Wealthfolio 3.6.1 host. This makes the importer visible and
  reachable after installation.

## 0.2.1

- Same as 0.2.0 (the v0.2.0 tag was burned: its release workflow failed on an
  attestation-version mismatch before any artifact was published).

## 0.2.0

- Manifest-declared sidebar navigation (`contributes.links.sidebar`); runtime
  registers only the route renderer whose id matches the manifest route id.
- Host dependencies derived from the SDK `HOST_DEPENDENCIES` map (single source
  of truth across Vite externals, manifest, and peer dependencies).
- Source-level sandbox-contract scan rejecting browser storage and direct
  networking APIs.
- `@wealthfolio/addon-sdk` dev dependency pinned to `~3.6.1`.
- Standardized to a named `enable` export (was a default export).
- No change to import parsing semantics.

## 0.1.0

- Wealthfolio 3.6.1 addon for Revolut investment CSV imports.
- Explicit ticker mapping with account-scoped persistence.
- Strict currency, amount, quantity, FX, duplicate, overlap, and reconciliation
  validation.
- Deterministic versioned ZIP packaging, checksums, privacy scanning, and
  tag-based release validation.
