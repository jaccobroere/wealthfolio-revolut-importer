# Install and use the Revolut importer

## Before you start

- Wealthfolio 3.6.1 or a compatible later release.
- A Revolut investment CSV export matching the documented schema.
- The addon ZIP and matching `SHA256SUMS` from the same GitHub Release.

## Verify and install

Download both release assets into one directory and verify the checksum:

```sh
shasum -a 256 -c SHA256SUMS
```

Continue only when the command reports a match. In Wealthfolio, open the addon
installer/settings, choose the verified ZIP, and enable the addon.

## Import a statement

1. Open the Revolut importer from the Wealthfolio addon navigation.
2. Choose the Revolut investment CSV.
3. Choose the destination Wealthfolio account.
4. Review every ticker and confirm its Wealthfolio instrument mapping.
5. Resolve validation, duplicate, rounding, and reconciliation messages.
6. Confirm the import only when the review is complete.

The importer does not write activities while you are selecting a file or
reviewing mappings. Re-import checks run before the final write.

## If an import is blocked

- Confirm that the export is the investment CSV, not another Revolut report.
- Keep the original exported CSV unchanged and export it again if the header
  does not match the [supported format](FORMAT.md).
- Correct unsupported activity types, malformed values, and currency errors in
  the source export or exclude the affected file until it can be reviewed.
- If the checksum does not match, download the release assets again.

For a reproducible bug report, attach a small synthetic fixture or a redacted
description. Do not attach a personal statement.
