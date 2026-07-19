import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const disposablePassword = 'wf-revolut-disposable-password';
export const ROOT = path.resolve(import.meta.dirname, '../..');
const packageMetadata = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
export const packagedAddon = path.join(
  ROOT,
  'artifacts',
  `${packageMetadata.name}-${packageMetadata.version}.zip`,
);
export const e2eCashStatement = path.join(ROOT, 'tests/fixtures/revolut-e2e-cash.csv');
export const e2eOverlapStatement = path.join(ROOT, 'tests/fixtures/revolut-e2e-overlap.csv');
export const e2eInvalidStatement = path.join(ROOT, 'tests/fixtures/revolut-unknown-type.csv');
export const e2ePortfolioStatement = path.join(ROOT, 'tests/fixtures/revolut-e2e-portfolio.csv');
export const portfolioAccountName = 'Revolut E2E USD';

export function assertExactArchive(): void {
  const expected = readFileSync(path.join(ROOT, 'artifacts/SHA256SUMS'), 'utf8')
    .split('\n')
    .find((line) => line.endsWith(path.basename(packagedAddon)))
    ?.trim()
    .split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(packagedAddon)).digest('hex');
  if (!expected || actual !== expected) {
    throw new Error('The E2E harness only accepts the SHA256SUMS-validated release archive.');
  }
}

/** Released host renders packaged add-ons in an isolated iframe sandbox. */
export function addonFrame(page: Page) {
  return page.frameLocator('iframe');
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/');

  const password = page.getByRole('textbox', { name: 'Enter your password' });
  await expect(password).toBeVisible({ timeout: 10_000 });
  await password.fill(disposablePassword);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(password).toBeHidden();
}

export async function signInAndOnboard(page: Page): Promise<void> {
  await signIn(page);
  if (!page.url().includes('/onboarding')) return;

  await page.getByTestId('onboarding-continue-button').click();
  await page.getByRole('button', { name: 'EUR' }).click();
  await page.getByRole('button', { name: 'Amsterdam' }).click();
  await page.getByTestId('onboarding-continue-button').click();
  await page.getByTestId('onboarding-continue-button').click();
  const finishButton = page.getByTestId('onboarding-finish-button');
  await expect(finishButton).toBeVisible();
  await finishButton.click();
  await expect(page).not.toHaveURL(/\/onboarding/);
}

export async function installPackagedAddon(page: Page): Promise<void> {
  assertExactArchive();
  await page.goto('/settings/addons');
  const installedPanel = page.getByRole('tabpanel', { name: 'Installed' }).first();
  if (await page.getByText('Revolut Importer', { exact: true }).count()) {
    return;
  }
  const installButton = installedPanel.getByRole('button', { name: 'Install from File' }).first();
  await expect(installButton).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await installButton.click();
  await (await chooser).setFiles(packagedAddon);
  await page.getByRole('button', { name: /^Approve(?: & Install)?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Revolut Importer' }).first()).toBeVisible();
}

/** Create the disposable transaction-tracked EUR account used by import tests. */
export async function createSyntheticAccount(
  page: Page,
  accountName = 'Revolut E2E',
  currency = 'EUR',
): Promise<void> {
  await page.goto('/settings/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox', { name: 'Account Name' }).fill(accountName);
  await page.getByRole('radio', { name: /Transactions/ }).check();
  if (currency !== 'EUR') {
    await page.getByRole('combobox', { name: 'Currency' }).click();
    await page.getByRole('option', { name: new RegExp(`\\(${currency}\\)$`) }).click();
  }
  await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  const visibleAccountLink = page
    .locator('main')
    .locator('a:visible')
    .filter({
      hasText: new RegExp(`^${accountName}$`),
    });
  await expect(visibleAccountLink).toHaveCount(1);
}

/** Advance a cash-only statement to the explicit reconciliation confirmation. */
export async function uploadCashStatementToConfirmation(
  page: Page,
  statement = e2eCashStatement,
): Promise<void> {
  await page.goto('/addon/revolut-importer');
  const addon = addonFrame(page);
  await addon.getByLabel('Revolut CSV file').setInputFiles(statement);
  await expect(addon.getByLabel('Destination account')).toBeVisible();
  await addon.getByLabel('Destination account').selectOption({ label: 'Revolut E2E (EUR)' });
  await addon.getByTestId('mapping-continue').click();
  await addon.getByTestId('review-continue').click();
  await addon.getByRole('checkbox').check();
  await expect(addon.getByRole('button', { name: /^Import/ })).toBeEnabled();
}

/** Upload a mapped instrument statement and stop at the explicit import confirmation. */
export async function uploadPortfolioToConfirmation(page: Page): Promise<void> {
  await page.goto('/addon/revolut-importer');
  const addon = addonFrame(page);
  await addon.getByLabel('Revolut CSV file').setInputFiles(e2ePortfolioStatement);
  await expect(addon.getByLabel('Destination account')).toBeVisible();
  await addon
    .getByLabel('Destination account')
    .selectOption({ label: `${portfolioAccountName} (USD)` });
  for (const ticker of ['AAPL', 'MSFT']) {
    await expect(addon.getByTestId(`search-btn-${ticker}`)).toBeVisible();
    await addon.getByTestId(`search-btn-${ticker}`).click();
    await expect(addon.getByTestId(`search-results-${ticker}`)).toBeVisible();
    await addon.getByTestId(`search-result-${ticker}-0`).click();
  }
  await addon.getByTestId('mapping-continue').click();
  await addon.getByTestId('review-continue').click();
  await addon.getByRole('checkbox').check();
  await expect(addon.getByRole('button', { name: /^Import/ })).toBeEnabled();
}
