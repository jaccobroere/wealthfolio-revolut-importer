# Changelog

All notable changes to the wealthfolio-revolut-importer addon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- T02 baseline: 3.6.1 toolchain (pnpm 10.34.5, Node 20.19.0, vite 7, strict TS),
  licensing (MIT), privacy rules, package normalization (id `revolut-importer`,
  name `wealthfolio-revolut-importer`), SDK contract docs, and the sandbox shell
  scaffolded from `@wealthfolio/addon-dev-tools@3.6.1`.
- T04 pure core: strict eight-column Revolut CSV parser (header reorder ok;
  missing/unknown/duplicate columns fail with an actionable error);
  `decimal.js`-based prefixed-money parsing (`EUR 287.30` → canonical `287.3`,
  prefix validated against `Currency`); full-ISO-timestamp date parsing with no
  rollover coercion; exact source-type → activity-type mapping (`BUY - MARKET`
  → `BUY`, …, `REWARD` → `CREDIT/BONUS`); unknown types block as `UNKNOWN`;
  absolute-positive amount normalization with signed-raw provenance; Web-Crypto
  SHA-256 source fingerprints over the canonical field sequence; per-ticker /
  per-currency / credits / dividends reconciliation plus diagnostic
  trade-rounding variance (`|qty × displayed price − Total Amount|`, Total
  Amount authoritative). Pure core stays free of React / `@wealthfolio/addon-sdk`
  imports.
- T04 `inspect:csv` script (`--summary-only`, privacy-safe) and a local-only
  acceptance suite (`acceptance:local`) that reads the real statement via
  `REVOLUT_ACCEPTANCE_CSV`, fails fast on missing/unreadable/non-regular input,
  and asserts the reviewed 152-row counts, EUR/USD strict validation, 152
  unique fingerprints, 17 trade-rounding diagnostics with exact maximum
  variance `0.4436557132`, and deterministic reconciliation invariants.
  Acceptance output is aggregate-only; the real statement is never committed.

### Changed

- `tsconfig.json` now type-checks `tests/` and `scripts/` in addition to `src/`.

## [0.1.0] - unreleased

Initial development version. Importer core, host adapter, and review UI land in
later tasks (T04–T07); disposable-host integration (T09) and release (T10) are
separate approval gates.
