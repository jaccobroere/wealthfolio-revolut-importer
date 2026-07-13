# Revolut input format

The importer accepts the documented Revolut investment CSV schema. Other
Revolut exports are not interchangeable with this file.

## Columns

The file must contain these eight columns exactly once. They may appear in a
different order, but names may not be renamed, added, or omitted:

```text
Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
```

Cash movements and credits leave security-specific fields empty where the
source format does so.

## Supported source types

| Revolut type        | Wealthfolio activity  |
| ------------------- | --------------------- |
| `BUY - MARKET`      | `BUY`                 |
| `SELL - MARKET`     | `SELL`                |
| `CASH TOP-UP`       | `DEPOSIT`             |
| `CASH WITHDRAWAL`   | `WITHDRAWAL`          |
| `DIVIDEND`          | `DIVIDEND`            |
| `COMMISSION REFUND` | `CREDIT` / fee refund |
| `REWARD`            | `CREDIT` / bonus      |

Any other type is reported as unsupported and blocks the import.

## Validation

Dates must be valid ISO timestamps. Currency fields must use strict uppercase
three-letter codes. Money values must include a valid currency prefix, and
quantities, prices, and FX rates must be valid positive decimal values where
the activity requires them.

The importer reports the difference between displayed unit-price arithmetic and
the source total as a rounding diagnostic. It preserves the source total rather
than silently replacing it with a recalculated float.
