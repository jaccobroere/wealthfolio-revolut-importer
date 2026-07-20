import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type FrameLocator, type Page } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../..');
const packageMetadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const addonZip = path.join(
  root,
  'artifacts',
  `${packageMetadata.name}-${packageMetadata.version}.zip`,
);
const cashFixture = path.join(root, 'tests/fixtures/revolut-e2e-cash.csv');
const accountName = 'Revolut E2E';

function assertExactArchive(): void {
  const expected = readFileSync(path.join(root, 'artifacts/SHA256SUMS'), 'utf8')
    .split('\n')
    .find((line) => line.endsWith(path.basename(addonZip)))
    ?.trim()
    .split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(addonZip)).digest('hex');
  if (!expected || actual !== expected) {
    throw new Error('Host smoke tests require the SHA256SUMS-validated release archive.');
  }
}

/** Prepare an empty disposable host and install the packaged add-on. */
export async function prepareHost(page: Page): Promise<void> {
  await page.goto('/');
  const password = page.getByRole('textbox', { name: 'Enter your password' });
  await expect(password).toBeVisible({ timeout: 10_000 });
  await password.fill('wf-revolut-disposable-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(password).toBeHidden();

  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await page.getByTestId('onboarding-continue-button').click();
  await page.getByTestId('onboarding-continue-button').click();
  await page.getByTestId('onboarding-continue-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await expect(page).toHaveURL(/\/settings\/accounts/);

  assertExactArchive();
  await page.goto('/settings/addons');
  const updateDialogClose = page.getByRole('button', { name: 'Close dialog' });
  if (await updateDialogClose.count()) await updateDialogClose.click();
  const install = page.getByRole('button', { name: 'Install from File' }).first();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), install.click()]);
  await chooser.setFiles(addonZip);
  await page.getByRole('button', { name: /^Approve(?: & Install)?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Revolut Importer' }).first()).toBeVisible();

  await page.goto('/settings/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox', { name: 'Account Name' }).fill(accountName);
  await page.getByRole('radio', { name: /Transactions/ }).check();
  await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  await expect(page.locator('main').getByText(accountName, { exact: true })).toBeVisible();
}

/** Upload the synthetic cash fixture and advance it to explicit import confirmation. */
export async function prepareCashImport(page: Page): Promise<FrameLocator> {
  await page.goto('/addon/revolut-importer');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Revolut CSV file').setInputFiles(cashFixture);
  await expect(frame.getByLabel('Destination account')).toBeVisible();
  await frame.getByLabel('Destination account').selectOption({ label: `${accountName} (EUR)` });
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByRole('checkbox').check();
  await expect(frame.getByRole('button', { name: /^Import/ })).toBeEnabled();
  return frame;
}
