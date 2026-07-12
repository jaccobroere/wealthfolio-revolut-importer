import { expect, type Page } from '@playwright/test';

export const disposablePassword = 'wf-revolut-disposable-password';
export const packagedAddon = 'artifacts/wealthfolio-revolut-importer-0.1.0.zip';

export async function signIn(page: Page): Promise<void> {
  await page.goto('/');

  const password = page.getByRole('textbox', { name: 'Enter your password' });
  await expect(password).toBeVisible({ timeout: 10_000 });
  await password.fill(disposablePassword);
  await page.getByRole('button', { name: 'Sign In' }).click();
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
