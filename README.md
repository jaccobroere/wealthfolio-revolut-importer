# wealthfolio-revolut-importer

A [Wealthfolio](https://github.com/wealthfolio/wealthfolio) **3.6.1** addon that
imports Revolut investment CSV statements with explicit symbol review,
duplicate-safe imports, and full row-level reconciliation.

## Status

Private. Targeted at Wealthfolio host `3.6.1`. Initial release version `0.1.0`.
Addon id `revolut-importer`; route `/addon/revolut-importer`.

Scaffolded from the official `@wealthfolio/addon-dev-tools@3.6.1` template.

## Supported schema

Only the exact Revolut investment CSV header is supported initially:

```
Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
```

Changed or unknown schemas fail visibly. Money is prefixed with its ISO currency
(e.g. `EUR 287.30`, `USD 1.24`). `Total Amount` is authoritative for cash
movement; the displayed unit price is retained as diagnostic provenance.

## Requirements

- Node `20.19.0` (see `.nvmrc`) — the scaffold pins `vite@^7.1.5`, which requires
  Node 20.19+ or 22.12+.
- pnpm `10.34.5` (pinned via `packageManager`).

## Install dependencies

```bash
pnpm install
```

## Common scripts

```bash
pnpm build          # vite build -> dist/addon.js
pnpm dev            # vite build --watch
pnpm type-check     # tsc --noEmit
pnpm test           # vitest run (synthetic fixtures only)
pnpm lint
pnpm format
pnpm verify         # CI-safe: synthetic tests, build, privacy and ZIP validation
pnpm verify:release # local only: requires REVOLUT_ACCEPTANCE_CSV
```

`pnpm verify` never reads a personal statement. `pnpm verify:release` is the
mandatory local release gate: it requires `REVOLUT_ACCEPTANCE_CSV`, runs the
summary-only acceptance suite, and creates `artifacts/wealthfolio-revolut-importer-0.1.0.zip`
plus `artifacts/SHA256SUMS`. It does not publish, tag, or install anything.

## Download and install ZIP

The ZIP is the distributable product. Download the versioned ZIP, verify it
with `(cd artifacts && shasum -a 256 -c SHA256SUMS)`, then select that ZIP in
Wealthfolio's add-on installer. The archive contains only the manifest, this
README, and runtime build files; it does not contain source, tests, lockfiles,
or statements.

## Privacy

This addon never logs raw rows, filenames, account identifiers, balances, or
order ids. See `docs/PRIVACY.md`. Real Revolut statements are **never**
committed; only manually reviewed synthetic fixtures live in this repository.

The local acceptance test reads a real statement through an environment variable
only — see `.env.acceptance.example`:

```bash
cp .env.acceptance.example .env   # gitignored
# edit .env to point REVOLUT_ACCEPTANCE_CSV at your real statement
```

## Documentation

- `docs/SDK-CONTRACT.md` — verified Wealthfolio 3.6.1 host/SDK contract.
- `docs/PRIVACY.md` — privacy rules for code and output.

## License

MIT (c) 2026 Jacco Broere.
