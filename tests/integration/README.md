# Disposable Wealthfolio 3.6.1 host proof

This harness is exclusively for the Revolut add-on's local T09 gate. It creates
the Compose project `wf-revolut-addon-test`, uses only the named volume
`wf-revolut-addon-test-data`, and binds the host on loopback only.

It must use this exact immutable host image:

```
wealthfolio/wealthfolio:3.6.1@sha256:2819715df7057a46a29f30cd3c3e713df3bbe424b3a1bf7f2c92dc1dea1f84a6
```

## Run

```sh
cp tests/integration/.env.example tests/integration/.env
shasum -a 256 -c artifacts/SHA256SUMS
docker compose --env-file tests/integration/.env -f tests/integration/compose.yml up -d
pnpm integration:revolut
```

The integration suite installs only
`artifacts/wealthfolio-revolut-importer-0.1.0.zip`; it never loads `dist/`.
Set `REVOLUT_ACCEPTANCE_CSV` to an absolute local path only when running the
real-statement parse-only test. The statement is uploaded to the disposable
host, is never copied into this repository, and is never persisted through the
import confirmation step.

## T09 atomicity regression

`tests/e2e/import.spec.ts` first runs the packaged add-on's normal
`checkImport` flow. It then uses the authenticated disposable host's exact
released-source routes (`POST /api/v1/activities/import/check`, whose body is
`{ activities }`, and `POST /api/v1/activities/bulk`, whose body is
`{ creates }`) because the UI correctly prevents a mixed-validity batch from
reaching save. The synthetic bulk request has one valid deposit and one empty
activity type. The test requires zero returned creates, an error for the
invalid create, and neither probe ID in a follow-up activity search. This is
the 3.6.1 all-or-nothing proof; it does not use a production host or data.

## Teardown

Always destroy only this harness's project and named volume:

```sh
docker compose --env-file tests/integration/.env -f tests/integration/compose.yml down --volumes --remove-orphans
```

Do not connect this compose file to external networks, database/proxy services,
or any production resource. The suite uses a synthetic account and credentials.
