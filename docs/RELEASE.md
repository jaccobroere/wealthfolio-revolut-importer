# Tag release process

Run `pnpm verify:release` locally with the real statement and ignored baseline.
This private gate is mandatory before tagging and is never run in GitHub
Actions. It builds the deterministic versioned ZIP, creates `SHA256SUMS`, and
validates the archive.

Commit the sanitized release attestation, then create an exact `vX.Y.Z` tag.
The tag workflow validates ancestry, versions, synthetic verification, archive
contents, deterministic bytes, checksum, and attestation before publishing
only the ZIP and `SHA256SUMS`. Visibility, production installation, and VPS
changes remain separate approvals.
