# Privacy rules

Public repositories contain only synthetic fixtures. Real statements and their
reviewed JSON baselines are local acceptance inputs and are never committed,
logged, attached, or published.

`REVOLUT_ACCEPTANCE_CSV` points to the local statement and
`REVOLUT_ACCEPTANCE_BASELINE` points to its ignored baseline. Both are required
by `pnpm acceptance:local`; public CI uses synthetic fixtures only.

The privacy gate scans tracked text, CSVs, docs, manifests, release files,
archives, all refs/history, and unreachable Git blobs. Release ZIPs contain
only `manifest.json`, `README.md`, and the runtime asset closure.
