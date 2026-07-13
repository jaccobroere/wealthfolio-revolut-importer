# wealthfolio-revolut-importer

A Wealthfolio 3.6.1 addon for the supported Revolut investment CSV schema.
Public fixtures are synthetic and cover supported transaction types, strict
currency parsing, rounding diagnostics, duplicates, overlaps, and invalid rows.

Use Node 20.19.0 and pnpm 10.34.5. Run `pnpm test`, `pnpm build`, and
`pnpm verify`; public verification never reads a real statement. The private
`pnpm acceptance:local` gate requires `REVOLUT_ACCEPTANCE_CSV` and
`REVOLUT_ACCEPTANCE_BASELINE`.

Install a verified versioned ZIP through Wealthfolio’s add-on installer after
checking `SHA256SUMS`. Review symbols before import; mappings are account
scoped, duplicates are fingerprint-safe, and unsupported schemas fail visibly.
See `docs/PRIVACY.md`, `docs/RELEASE.md`, and `docs/INSTALL.md`.
