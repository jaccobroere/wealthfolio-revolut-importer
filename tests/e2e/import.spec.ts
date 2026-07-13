import { expect, test } from '@playwright/test';
import { Decimal } from 'decimal.js';

import {
  addonFrame,
  createSyntheticAccount,
  e2eInvalidStatement,
  e2eOverlapStatement,
  installPackagedAddon,
  signIn,
  signInAndOnboard,
  uploadCashStatementToConfirmation,
} from './helpers';

test.describe.serial('installed Revolut package lifecycle', () => {
  test('installs the final ZIP and renders one route root across navigation', async ({ page }) => {
    await signInAndOnboard(page);
    await installPackagedAddon(page);

    await page.goto('/addon/revolut-importer');
    await expect(page.locator('[data-addon-id="revolut-importer"]')).toHaveCount(1);

    await page.goto('/');
    await page.goto('/addon/revolut-importer');
    await expect(page.locator('[data-addon-id="revolut-importer"]')).toHaveCount(1);
  });

  test('disables and re-enables without retaining a route root', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings/addons');
    const installedPanel = page.getByRole('tabpanel', { name: /Installed/ }).first();
    const toggle = installedPanel.getByRole('switch');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    await page.goto('/addon/revolut-importer');
    await expect(page.locator('[data-addon-id="revolut-importer"]')).toHaveCount(0);

    await page.goto('/settings/addons');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.goto('/addon/revolut-importer');
    await expect(page.locator('[data-addon-id="revolut-importer"]')).toHaveCount(1);
  });

  test('checks synthetic imports before saving, persists metadata, and is duplicate safe', async ({
    page,
  }) => {
    await signIn(page);
    await createSyntheticAccount(page);
    await uploadCashStatementToConfirmation(page);

    const activityPosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/activities')) {
        activityPosts.push(request.url());
      }
    });

    await addonFrame(page)
      .getByRole('button', { name: /^Import/ })
      .click();
    await expect(addonFrame(page).getByTestId('import-summary-created')).toHaveText(/Created\s*2/);

    // Released 3.6.1 performs read-only validation, activity search/getAll,
    // then bulk persistence in that order.
    expect(activityPosts).toHaveLength(3);
    expect(activityPosts[0]).toMatch(/activities\/import\/check$/);
    expect(activityPosts[1]).toMatch(/activities\/search$/);
    expect(activityPosts[2]).toMatch(/activities\/bulk$/);

    // Direct host activity search/getAll evidence: metadata survives the write
    // and is returned by the host's activity search API.
    const activitySearch = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/activities/search'),
    );
    await page.goto('/activities');
    const searchedActivities = (await (await activitySearch).json()) as {
      data: Array<{
        activityType: 'DEPOSIT' | 'WITHDRAWAL';
        amount: string;
        metadata?: Record<string, unknown>;
      }>;
    };
    expect(searchedActivities.data).toHaveLength(2);
    expect(searchedActivities.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ importerId: 'revolut-importer' }),
        }),
      ]),
    );
    const cashNet = searchedActivities.data.reduce(
      (total, activity) =>
        activity.activityType === 'WITHDRAWAL'
          ? total.minus(activity.amount)
          : total.plus(activity.amount),
      new Decimal(0),
    );
    expect(cashNet.toFixed(2)).toBe('52.00');

    // The host exposes mappings to the sandbox bridge. Persist a synthetic
    // canonical identity, restart the add-on route, and read it back.
    const mappingRoundTrip = await page.evaluate(async () => {
      const accounts = (await fetch('/api/v1/accounts').then((response) =>
        response.json(),
      )) as Array<{
        id: string;
        name: string;
      }>;
      const account = accounts.find(({ name }) => name === 'Revolut E2E');
      if (!account) throw new Error('Synthetic E2E account is missing');
      const endpoint = `/api/v1/activities/import/mapping?accountId=${encodeURIComponent(account.id)}&contextKind=revolut`;
      const current = (await fetch(endpoint).then((response) => response.json())) as {
        accountId: string;
        fieldMappings: Record<string, string | string[]>;
        activityMappings: Record<string, string[]>;
        symbolMappings: Record<string, string>;
        accountMappings: Record<string, string>;
      };
      const mapping = {
        ...current,
        symbolMappings: { ...current.symbolMappings, 'SYNTH-E2E': 'SYNTH-E2E|XNAS|test' },
      };
      const saved = await fetch('/api/v1/activities/import/mapping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapping }),
      });
      if (!saved.ok) throw new Error(`Could not save synthetic mapping: ${saved.status}`);
      return { endpoint, expected: mapping.symbolMappings['SYNTH-E2E'] };
    });
    await page.goto('/addon/revolut-importer');
    const persistedMapping = await page.evaluate(async (endpoint) => {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`Could not reload synthetic mapping: ${response.status}`);
      return (await response.json()) as { symbolMappings: Record<string, string> };
    }, mappingRoundTrip.endpoint);
    expect(persistedMapping.symbolMappings['SYNTH-E2E']).toBe(mappingRoundTrip.expected);

    // Exact repeat has no creates; the same source overlap retains only the two existing rows.
    await uploadCashStatementToConfirmation(page);
    await addonFrame(page)
      .getByRole('button', { name: /^Import/ })
      .click();
    await expect(addonFrame(page).getByTestId('import-summary-created')).toHaveText(/Created\s*0/);
    await expect(addonFrame(page).getByTestId('import-summary-skipped-duplicates')).toHaveText(
      /Skipped duplicates\s*2/,
    );

    // Overlap contains the two existing rows plus one new deposit: only the
    // new row is persisted.
    await uploadCashStatementToConfirmation(page, e2eOverlapStatement);
    await addonFrame(page)
      .getByRole('button', { name: /^Import/ })
      .click();
    await expect(addonFrame(page).getByTestId('import-summary-created')).toHaveText(/Created\s*1/);
    await expect(addonFrame(page).getByTestId('import-summary-skipped-duplicates')).toHaveText(
      /Skipped duplicates\s*2/,
    );
  });

  test('blocks an invalid synthetic row before any activity write', async ({ page }) => {
    await signIn(page);
    await page.goto('/addon/revolut-importer');
    const addon = addonFrame(page);
    const activityPosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/activities')) {
        activityPosts.push(request.url());
      }
    });
    await addon.getByLabel('Revolut CSV file').setInputFiles(e2eInvalidStatement);
    await addon.getByLabel('Destination account').selectOption({ label: 'Revolut E2E (EUR)' });
    await addon.getByTestId('mapping-continue').click();
    await expect(addon.getByTestId('review-continue')).toBeDisabled();
    expect(activityPosts).toEqual([]);
  });

  test('returns no creates when a checked mixed bulk request contains an invalid create', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/settings/accounts');
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.getByRole('textbox', { name: 'Account Name' }).fill('Revolut Atomicity Probe');
    await page.getByRole('radio', { name: /Transactions/ }).check();
    await page.getByRole('button', { name: 'Add Account', exact: true }).click();

    // The released v3.6.1 source maps this authenticated host route directly
    // to activities.saveMany. The add-on UI cannot advance a mixed-validity
    // batch past its review gate, so use the source-confirmed API only after
    // the same read-only checkImport route. checkImport rejects an invalid
    // type at HTTP validation, so it gates the valid row before saveMany; the
    // invalid empty type is then accepted by the bulk JSON DTO but rejected
    // during bulk-save preparation.
    const probe = await page.evaluate(async () => {
      const accounts = (await fetch('/api/v1/accounts').then((response) =>
        response.json(),
      )) as Array<{
        id: string;
        name: string;
      }>;
      const account = accounts.find(({ name }) => name === 'Revolut Atomicity Probe');
      if (!account) throw new Error('Atomicity probe account is missing');

      const imports = [
        {
          id: 'synthetic-valid-import',
          accountId: account.id,
          activityType: 'DEPOSIT',
          date: '2026-07-13',
          symbol: '',
          amount: '11.00',
          currency: 'EUR',
          isValid: true,
          isDraft: true,
        },
      ];
      const checkedResponse = await fetch('/api/v1/activities/import/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activities: imports }),
      });
      if (!checkedResponse.ok) throw new Error(`checkImport failed: ${checkedResponse.status}`);
      const checked = (await checkedResponse.json()) as Array<{ id: string; isValid: boolean }>;

      const savedResponse = await fetch('/api/v1/activities/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          creates: [
            {
              id: 'synthetic-valid-create',
              accountId: account.id,
              activityType: 'DEPOSIT',
              activityDate: '2026-07-13',
              amount: '11.00',
              currency: 'EUR',
            },
            {
              id: 'synthetic-invalid-create',
              accountId: account.id,
              activityType: '',
              activityDate: '2026-07-13',
              amount: '13.00',
              currency: 'EUR',
            },
          ],
        }),
      });
      if (!savedResponse.ok) throw new Error(`saveMany failed: ${savedResponse.status}`);
      const saved = (await savedResponse.json()) as {
        created: Array<{ id: string }>;
        errors: Array<{ id?: string; action: string }>;
      };

      const searchResponse = await fetch('/api/v1/activities/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          page: 0,
          pageSize: 100,
          accountIdFilter: [account.id],
          activityTypeFilter: ['DEPOSIT'],
          sort: { id: 'date', desc: true },
        }),
      });
      if (!searchResponse.ok) throw new Error(`activity search failed: ${searchResponse.status}`);
      const search = (await searchResponse.json()) as { data: Array<{ id: string }> };

      return { checked, saved, persistedIds: search.data.map(({ id }) => id) };
    });

    expect(probe.checked).toEqual([expect.objectContaining({ isValid: true })]);
    expect(probe.saved.created).toEqual([]);
    expect(probe.saved.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'synthetic-invalid-create', action: 'create' }),
      ]),
    );
    expect(probe.persistedIds).not.toContain('synthetic-valid-create');
    expect(probe.persistedIds).not.toContain('synthetic-invalid-create');
  });
});
