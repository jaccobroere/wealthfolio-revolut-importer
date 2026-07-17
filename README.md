# Revolut Investment Importer for Wealthfolio

Import a Revolut investment CSV into Wealthfolio with strict validation,
explicit ticker review, reconciliation diagnostics, and duplicate-safe writes.

This addon is designed for Wealthfolio 3.6.1+. It reads the exported file
locally; it does not connect to Revolut and does not send your statement to a
service.

[Install](docs/INSTALL.md) · [Input format](docs/FORMAT.md) · [Privacy](docs/PRIVACY.md) · [Contributing](CONTRIBUTING.md)

## Compatibility

- Wealthfolio: >= 3.6.1
- Add-on SDK: 3.6.x (built against 3.6.1)

| Component     | Supported version or format                  |
| ------------- | -------------------------------------------- |
| Wealthfolio   | >= 3.6.1                                     |
| Addon package | `wealthfolio-revolut-importer-<version>.zip` |
| Source file   | Revolut investment CSV schema v1             |
| License       | MIT; see [LICENSE](LICENSE)                  |

## Install a release

1. Download the addon ZIP and `SHA256SUMS` from a GitHub Release.
2. Verify the download:

   ```sh
   shasum -a 256 -c SHA256SUMS
   ```

3. Install the verified ZIP from Wealthfolio's addon settings.
4. Open the Revolut importer and follow the review steps before importing.

See the complete [installation guide](docs/INSTALL.md).

## Import workflow

1. Export the investment CSV from Revolut.
2. Select the file and the Wealthfolio account that should receive the data.
3. Review every ticker and confirm its Wealthfolio instrument mapping.
4. Inspect validation, duplicate, rounding, and reconciliation messages.
5. Import only after the review is complete.

Mappings are scoped to the selected Wealthfolio account. Repeating the same
import, or importing overlapping date ranges, is protected by stable row
fingerprints and import checks. Changing the account or a mapping requires a
new reconciliation acknowledgement. If Wealthfolio rejects a draft, the
importer shows safe row-level diagnostics without exposing statement data.

## Supported CSV content

The importer accepts the eight-column Revolut investment schema. Column order
may vary, but names must match exactly and there must be no missing, extra, or
duplicate columns.

Supported source types are:

- `BUY - MARKET` and `SELL - MARKET`;
- `CASH TOP-UP` and `CASH WITHDRAWAL`;
- `DIVIDEND`;
- `COMMISSION REFUND` and `REWARD` credits.

Currency values, signed amounts, quantities, prices, and FX rates are validated
strictly. Displayed-price rounding differences are reported as diagnostics;
they do not silently change the source totals.

See [the input-format reference](docs/FORMAT.md) for the exact columns and
validation rules.

## Safety and privacy

- The addon processes the selected CSV locally inside Wealthfolio.
- Tickers are reviewed explicitly; the addon does not guess silently.
- Duplicate and overlapping imports are checked before writes.
- Every row is accounted for as imported, duplicate, invalid, unsupported, or
  otherwise intentionally handled.
- This public repository contains synthetic fixtures only. Real statements and
  local acceptance baselines are never committed or published.

Read the [privacy policy](docs/PRIVACY.md) for the repository and release
guarantees.

## Limitations

- Only the documented Revolut investment CSV schema is supported; other Revolut
  exports are not interchangeable.
- Instrument mapping requires user review and a Wealthfolio market-data match.
- The addon does not provide investment, tax, or accounting advice.
- A release ZIP is an addon package, not a standalone broker client.

## Development

```sh
pnpm install
pnpm verify
```

Public verification uses synthetic fixtures. Real-statement acceptance is a
separate local-only gate. See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[development guide](docs/DEVELOPMENT.md).
