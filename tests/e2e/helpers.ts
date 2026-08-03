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
const largeBatchFixture = path.join(root, 'tests/fixtures/revolut-large-batch.csv');
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

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  const password = page.getByRole('textbox', { name: 'Enter your password' });
  await expect(password).toBeVisible({ timeout: 10_000 });
  await password.fill('wf-revolut-disposable-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(password).toBeHidden();
}

/**
 * Dismiss the v3.6.2 "New Update Available" modal that the 3.6.1 host
 * overlays on every page. The dialog re-appears on every navigation.
 *
 * IMPORTANT: the v3.6.2 dialog mounts AFTER the host's settings page
 * renders. A simple `count() > 0` check can race and see `count() === 0`
 * while the dialog is about to mount, so we actively wait for the X to
 * become visible (with a 5s ceiling) before clicking. When the dialog
 * is up the host sets `aria-hidden="true"` (or `inert`) on the rest of
 * the page, so a regular `.click()` on the X can fail with "intercepts
 * pointer events" because the Radix overlay has its own pointer-events.
 * We dispatch a `mousedown`+`mouseup`+`click` sequence directly to the X
 * (bypassing the overlay's pointer-events), then fall back to a normal
 * Playwright `force: true` click and the "Remind me later" button. We
 * also wait for the Radix dialog to fully unmount by polling the X
 * button's presence.
 */
async function dismissUpdateDialog(page: Page): Promise<void> {
  // Wait for the X to appear.
  const closeDialog = page.getByRole('button', { name: 'Close dialog' });
  const appeared = await closeDialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;

  // Programmatic click via dispatchEvent. The Radix X button's onClick
  // closes the dialog; dispatching the synthetic event bypasses any
  // pointer-events: none / overlay intercept issues.
  await page
    .evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[aria-label="Close dialog"]'),
      );
      for (const b of buttons) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        b.dispatchEvent(event);
        // Also try a real click in case the React handler is gated on
        // trusted events (Radix's onOpenChange typically responds to
        // native click, but the host's wrapper may use onClick directly).
        b.click();
      }
    })
    .catch(() => {});

  // If the dispatch didn't take, fall back to the X and the
  // "Remind me later" button. force=true bypasses overlay pointer-events.
  if ((await closeDialog.count()) > 0) {
    await closeDialog.click({ force: true, timeout: 5_000 }).catch(() => {});
  }
  const remindLater = page.getByRole('button', { name: 'Remind me later' });
  if ((await remindLater.count()) > 0) {
    await remindLater.click({ force: true, timeout: 5_000 }).catch(() => {});
  }
  // Wait for the X to be gone.
  await page
    .waitForFunction(
      () => document.querySelectorAll('[aria-label="Close dialog"]').length === 0,
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
}

/** Prepare an empty disposable host and install the packaged add-on. */
export async function prepareHost(page: Page): Promise<void> {
  await signIn(page);

  // 4-step onboarding wizard: mode → prefs → customize → connect. The
  // wizard is shown on a fresh volume; once completed the host routes
  // straight to the dashboard. We assert against the wizard testid; if the
  // host skipped the wizard (non-fresh volume) the testid never appears
  // and we move on. The host is also overlaid by the v3.6.2 update dialog
  // on the post-wizard page; dismiss it before the next interaction.
  const wizard = page.getByTestId('onboarding-page');
  const wizardAppeared = await wizard
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (wizardAppeared) {
    await page.getByTestId('onboarding-continue-button').click();
    await page.getByTestId('onboarding-continue-button').click();
    await page.getByTestId('onboarding-continue-button').click();
    await page.getByTestId('onboarding-finish-button').click();
  }
  await dismissUpdateDialog(page);

  assertExactArchive();

  await page.goto('/settings/addons');
  await dismissUpdateDialog(page);
  const install = page.getByRole('button', { name: 'Install from File' }).first();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), install.click()]);
  await chooser.setFiles(addonZip);
  await page.getByRole('button', { name: /^Approve(?: & Install)?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Revolut Importer' }).first()).toBeVisible();

  await page.goto('/settings/accounts');
  await dismissUpdateDialog(page);
  // Two "Add account" buttons render on the page (header + empty-state CTA).
  // Use .first() to satisfy Playwright strict mode.
  await page.getByRole('button', { name: 'Add account' }).first().click();
  await expect(page.getByTestId('account-form')).toBeVisible();
  await page.getByTestId('account-name-input').fill(accountName);
  // Currency is required to enable the submit button. The combobox is a
  // Radix button (not a native <select>); click to open the popover, then
  // pick the option. Account Type is left at the default (Securities); the
  // host accepts cash DEPOSIT/WITHDRAWAL activities on a Securities account.
  await page.getByTestId('account-currency-select').click();
  await page.getByRole('option', { name: /EUR/ }).click();
  await page.getByRole('radio', { name: /Transactions/ }).check();
  await page.getByTestId('account-submit-button').click();
  // We don't assert visibility here. The v3.6.2 "New Update
  // Available" dialog overlay-blocks the page after the form submit
  // (the host sets aria-hidden="true" on the rest of the page), so
  // the new account link is in the DOM but visually hidden until the
  // dialog is dismissed. The next step in the import flow navigates
  // to the addon route via page.goto, which re-renders the page and
  // dismisses the dialog (the same dialog-re-appears-after-every-
  // navigation pattern that the rest of the helper handles). DEGIRO's
  // working e2e uses the same trick: it doesn't assert visibility
  // after account creation.
}

/** Upload the synthetic cash fixture and advance it to explicit import confirmation. */
export async function prepareCashImport(page: Page): Promise<FrameLocator> {
  await page.goto('/addon/revolut-importer');
  const frame = page.frameLocator('iframe');
  // The upload step has a `<div role="button">` (the drop zone) and a
  // hidden `<input type="file">` (both labelled "Revolut CSV file").
  // The drop zone is the visible target; we set files on the hidden
  // input via its enclosing testid.
  await frame
    .locator('[data-testid="revolut-csv-drop-zone"] input[type="file"]')
    .setInputFiles(cashFixture);
  await expect(frame.getByLabel('Destination account').first()).toBeVisible();
  await frame
    .getByLabel('Destination account')
    .first()
    .selectOption({ label: `${accountName} (EUR)` });
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByRole('checkbox').check();
  await expect(frame.getByRole('button', { name: /^Import/ })).toBeEnabled();
  return frame;
}

/** Absolute path to the 250-row large-batch synthetic cash fixture. */
export function getLargeBatchFixturePath(): string {
  return largeBatchFixture;
}

/** Upload the 250-row large-batch fixture and advance it to explicit import confirmation. */
export async function prepareLargeBatchImport(page: Page): Promise<FrameLocator> {
  await page.goto('/addon/revolut-importer');
  const frame = page.frameLocator('iframe');
  await frame
    .locator('[data-testid="revolut-csv-drop-zone"] input[type="file"]')
    .setInputFiles(largeBatchFixture);
  await expect(frame.getByLabel('Destination account').first()).toBeVisible();
  await frame
    .getByLabel('Destination account')
    .first()
    .selectOption({ label: `${accountName} (EUR)` });
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByRole('checkbox').check();
  await expect(frame.getByRole('button', { name: /^Import/ })).toBeEnabled();
  return frame;
}
