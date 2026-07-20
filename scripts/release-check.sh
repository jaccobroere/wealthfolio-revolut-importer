#!/bin/sh
set -eu

PNPM=${PNPM:-pnpm}

if [ -z "${REVOLUT_ACCEPTANCE_CSV:-}" ] || [ ! -f "$REVOLUT_ACCEPTANCE_CSV" ] || [ -z "${REVOLUT_ACCEPTANCE_BASELINE:-}" ] || [ ! -f "$REVOLUT_ACCEPTANCE_BASELINE" ]; then
  echo 'REVOLUT_ACCEPTANCE_CSV and REVOLUT_ACCEPTANCE_BASELINE must reference readable local files.' >&2
  exit 1
fi

git diff --quiet && git diff --cached --quiet || {
  echo 'Release verification requires a clean Git tree.' >&2
  exit 1
}

$PNPM check
$PNPM acceptance:local
$PNPM test:host
