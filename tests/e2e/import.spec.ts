import { expect, test } from '@playwright/test';

import { prepareCashImport, prepareHost, prepareLargeBatchImport } from './helpers';

test('imports a packaged add-on CSV once and skips the duplicate import', async ({ page }) => {
  await prepareHost(page);

  const firstImport = await prepareCashImport(page);
  await firstImport.getByRole('button', { name: /^Import/ }).click();
  await expect(firstImport.getByTestId('import-summary-created')).toHaveText(/Created\s*2/);

  const duplicateImport = await prepareCashImport(page);
  await duplicateImport.getByRole('button', { name: /^Import/ }).click();
  await expect(duplicateImport.getByTestId('import-summary-created')).toHaveText(/Created\s*0/);
  await expect(duplicateImport.getByTestId('import-summary-skipped-duplicates')).toHaveText(
    /Skipped duplicates\s*2/,
  );
});

test('imports a 250-row batch via chunked host writes', async ({ page }) => {
  await prepareHost(page);
  const view = await prepareLargeBatchImport(page);
  await view.getByRole('button', { name: /^Import/ }).click();
  // 250 alternating CASH TOP-UP / CASH WITHDRAWAL rows. The host import
  // call is chunked (default 100/chunk) so 250 rows become 3 host writes
  // (100/100/50).
  await expect(view.getByTestId('import-summary-created')).toHaveText(/Created\s*250/);
  // The chunk summary banner only renders when more than one chunk is used.
  await expect(view.getByTestId('chunk-summary')).toBeVisible();
});
