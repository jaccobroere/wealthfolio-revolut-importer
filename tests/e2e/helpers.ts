import { expect, type Page } from '@playwright/test';

export const disposablePassword = 'wf-revolut-disposable-password';
export const packagedAddon = 'artifacts/wealthfolio-revolut-importer-0.1.0.zip';
export const e2eCashStatement = 'tests/fixtures/revolut-e2e-cash.csv';
export const e2eOverlapStatement = 'tests/fixtures/revolut-e2e-overlap.csv';
export const e2eInvalidStatement = 'tests/fixtures/revolut-unknown-type.csv';

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
  await expect(page).toHaveURL(/\/onboarding/);

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
  await page.goto('/settings/addons');
  const installedPanel = page.getByRole('tabpanel', { name: 'Installed' }).first();
  await expect(installedPanel.getByText('0 add-ons installed', { exact: true })).toBeVisible();
  const installButton = installedPanel.getByRole('button', { name: 'Install from File' }).first();
  await expect(installButton).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await installButton.click();
  await (await chooser).setFiles(packagedAddon);
  await page.getByRole('button', { name: /^Approve(?: & Install)?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Revolut Importer' }).first()).toBeVisible();
}

/** Create the disposable transaction-tracked EUR account used by import tests. */
export async function createSyntheticAccount(page: Page): Promise<void> {
  await page.goto('/settings/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox', { name: 'Account Name' }).fill('Revolut E2E');
  await page.getByRole('radio', { name: /Transactions/ }).check();
  await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  const visibleAccountLink = page
    .locator('main')
    .locator('a:visible')
    .filter({
      hasText: /^Revolut E2E$/,
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
