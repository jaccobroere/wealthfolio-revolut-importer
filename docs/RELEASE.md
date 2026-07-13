# Release process

## Current status

Version `0.1.0` is the planned first release and is **BLOCKED**. No tag or
GitHub release has been published by this repository preparation.

The T09 release gate remains open: disposable-host proof is still required for
metadata round-trip, `saveMany` partial-versus-atomic behavior, and the host's
sign semantics for Revolut activity amounts. See `SDK-CONTRACT.md` for the
recorded contract limits.

## Future release checklist

After the T09 gate has been closed and release approval is granted:

1. Run `pnpm verify:release` locally. This is mandatory and must complete
   before any release operation.
2. Confirm the generated artifact name follows
   `wealthfolio-revolut-importer-<version>.zip` and that `SHA256SUMS` contains
   the checksum for that exact ZIP.
3. Verify the checksum from the artifact directory with
   `shasum -a 256 -c SHA256SUMS`.
4. Create one immutable version tag and release for the verified ZIP. Never
   replace, retag, or overwrite a published release artifact; publish a new
   version for any correction.

This document does not authorize Actions enablement, release publication,
production installation, or infrastructure changes.
