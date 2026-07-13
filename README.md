# wealthfolio-revolut-importer

A [Wealthfolio](https://github.com/wealthfolio/wealthfolio) **3.6.1** addon that
imports Revolut investment CSV statements with explicit symbol review,
duplicate-safe imports, and full row-level reconciliation.

## Status

Targeted at Wealthfolio host `3.6.1`. Initial release version `0.1.0` is
**BLOCKED** pending remaining T09 host proof. This repository has not published
that release or validated a production host.

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
pnpm verify:release # mandatory local release gate
```

`pnpm verify` uses synthetic fixtures only. `pnpm verify:release` is the
mandatory local release gate. It creates the versioned ZIP and `SHA256SUMS`,
but does not publish, tag, or install anything.

## Future download and installation

No ZIP is published while T09 is blocked. After a future approved immutable
release, download its versioned ZIP directly, verify it against that release's
`SHA256SUMS`, and select the verified ZIP in Wealthfolio's add-on installer.
See `docs/INSTALL.md`, `docs/RELEASE.md`, and `docs/ROLLBACK.md`.

## Privacy

This addon never logs raw rows, filenames, account identifiers, balances, or
order ids. See `docs/PRIVACY.md`. Real Revolut statements are **never**
committed; only manually reviewed synthetic fixtures live in this repository.

## Documentation

- `docs/SDK-CONTRACT.md` — verified Wealthfolio 3.6.1 host/SDK contract.
- `docs/PRIVACY.md` — privacy rules for code and output.
- `docs/RELEASE.md` — blocked release status and future release controls.
- `docs/INSTALL.md` / `docs/ROLLBACK.md` — future ZIP installation and safe rollback.

## License

MIT (c) 2026 Jacco Broere.
