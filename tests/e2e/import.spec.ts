import { expect, test } from '@playwright/test';

import { installPackagedAddon, signIn, signInAndOnboard } from './helpers';

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
});
