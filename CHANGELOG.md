# Changelog

Changes that affect users or maintainers are recorded here. Release-specific
notes live under [`docs/releases/`](docs/releases/).

## Unreleased

## 0.4.0 — 2026-09-15

- Added: fix problem rows in the review step instead of editing the CSV. Any
  row expands into per-row controls to edit its source values (with a live
  preview of how the corrected row validates) or ignore it. Ignored rows become
  a new `ignored` outcome with its own review category, so every row still
  produces exactly one outcome; edited rows are flagged in the review table and
  the reconcile step summarizes every change before acknowledgement. Overrides
  are never written back to the source file.
- Fixed: an edit that turned an invalid row into a valid trade could introduce a
  ticker the mapping step never saw, and Import would write it against an
  unverified symbol. Ticker entries are re-derived after every rebuild; new
  tickers block until confirmed, confirmed ones keep their resolution.
- Fixed: drafts, fingerprints, and source row numbers are now derived from one
  filtered list (`buildImportPayload`). They are zipped positionally, so
  excluding any row previously desynchronized them — failing the length guard,
  and mispairing idempotency keys had that guard not been there.
- Fixed: Import is blocked when the batch would write nothing, and when
  re-running validation after a reviewer decision fails (previously silent).
- Fixed: the reconciliation report is computed by an effect whenever the
  reconcile step lacks one, replacing a `queueMicrotask` ordering hack that
  could leave Import permanently blocked when a rebuild landed just after
  Continue was clicked.

## 0.3.0 — 2026-08-03

- Chunked the host `activities.import` call into fixed-size batches (default
  100 per chunk, configurable via `RunImportOptions.chunkSize`). Large
  Revolut statements no longer fail at the final submit step, and a single
  bad row or per-chunk host error no longer takes down a 200+ row batch.
  Only a complete host outage (every chunk throwing) is fatal; per-chunk
  failures are surfaced as per-row failures with sanitized messages.
- Dodged the Wealthfolio 3.6.1 host sandbox's `es-module-lexer` rewriter
  by dispatching `activities.import` through `Reflect.get`, so the
  `import` identifier is never in the call position of the minified
  bundle. The 3.6.1 host image SHA is recorded in `src/wealthfolio/api.ts`.
- Bumped the metadata `IMPORTER_VERSION` to `0.2.0` so the new release
  is forward-distinguishable from prior 0.1.x metadata on the host.

## 0.2.7

- Added a strongly masked, instrument-bearing account-statement fixture and
  disposable-host E2E proof for mapping, `activities.import`, persistence, and
  duplicate re-import.
- CI now builds the current declared add-on archive and runs the browser E2E
  suite against the pinned Wealthfolio 3.6.1 host.

## 0.2.4

- Made stale remembered ticker mappings visible, replaceable, and safely
  removable within the selected account.
- Added mapping search/retry and start-over recovery actions, plus a safe
  return-to-mapping path after a host-level bulk-write rejection.

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
