import { expect, test } from '@playwright/test';

test('real statement parse-only review is opt-in and never confirms an import', async ({ page }) => {
  test.skip(!process.env.REVOLUT_ACCEPTANCE_CSV, 'REVOLUT_ACCEPTANCE_CSV is not configured');
  await page.goto('/addon/revolut-importer');
  await page.locator('input[type="file"]').setInputFiles(process.env.REVOLUT_ACCEPTANCE_CSV!);
  await expect(page.getByText(/152 rows/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /import/i })).toBeDisabled();
});
