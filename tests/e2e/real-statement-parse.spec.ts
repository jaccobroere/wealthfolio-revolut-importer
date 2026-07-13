import { expect, test } from '@playwright/test';
import { addonFrame, installPackagedAddon, signInAndOnboard } from './helpers';

test('real statement parse-only review is opt-in and never confirms an import', async ({
  browser,
}) => {
  test.skip(!process.env.REVOLUT_ACCEPTANCE_CSV, 'REVOLUT_ACCEPTANCE_CSV is not configured');

  // This test deliberately owns its browser context. The disposable host has
  // no authenticated session or installed add-on in a fresh context, so it
  // must complete the same packaged-add-on lifecycle as a standalone run.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInAndOnboard(page);
    await installPackagedAddon(page);

    await page.goto('/addon/revolut-importer');
    const addon = addonFrame(page);
    const activityPosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/activities/')) {
        activityPosts.push(request.url());
      }
    });

    await addon.getByLabel('Revolut CSV file').setInputFiles(process.env.REVOLUT_ACCEPTANCE_CSV!);

    // The packaged add-on runs in the sandbox iframe. Assert only the reviewed
    // aggregate, never statement content, filename, path, or account data.
    const summary = addon.getByTestId('parsed-statement-summary');
    const parseError = addon.getByText('Could not parse CSV', { exact: true });
    await expect
      .poll(async () => (await summary.count()) + (await parseError.count()))
      .toBeGreaterThan(0);
    if (await parseError.isVisible()) {
      throw new Error('The approved parse-only input reached the UI parser error state.');
    }
    await expect(summary).toBeVisible();
    await expect(addon.getByTestId('parsed-row-count')).toHaveText('Rows: 152');
    await expect(addon.getByRole('button', { name: /^Import/ })).toHaveCount(0);
    expect(activityPosts).toEqual([]);
  } finally {
    await context.close();
  }
});
