/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ImporterPage } from '../../src/pages/importer-page';
import { createFakeHost } from '../wealthfolio/fake-host';
import {
  DEFAULT_SEARCH_RESULTS,
  UNKNOWN_CSV,
  createAddonContext,
  installFileReaderMock,
} from './helpers';

/** Drive the wizard to the review step with a statement containing a blocker. */
async function renderPageToReview() {
  const host = createFakeHost({ searchResults: DEFAULT_SEARCH_RESULTS });
  const ctx = createAddonContext(host.api);
  const fileReader = installFileReaderMock(UNKNOWN_CSV);

  const view = render(
    <ImporterPage
      ctx={ctx}
      location={{ pathname: '/addon/revolut-importer', search: '', hash: '', params: {} }}
    />,
  );

  const fileInput = await screen.findByLabelText('Revolut CSV file');
  fireEvent.change(fileInput, {
    target: { files: [new File([UNKNOWN_CSV], 'revolut.csv', { type: 'text/csv' })] },
  });

  await screen.findByTestId('mapping-continue');
  const accountSelect = await screen.findByLabelText('Destination account');
  await waitFor(() => {
    if ((accountSelect as HTMLSelectElement).disabled) {
      throw new Error('Destination account select is still loading');
    }
  });
  fireEvent.change(accountSelect, { target: { value: 'acct-1' } });

  await waitFor(() => {
    const button = screen.getByTestId('mapping-continue') as HTMLButtonElement;
    if (button.disabled) throw new Error('Mapping continue still disabled');
  });
  fireEvent.click(screen.getByTestId('mapping-continue'));
  await screen.findByTestId('review-continue');

  return { ...view, host, restoreFileReader: fileReader.restore };
}

describe('review step — in-place row fixes', () => {
  afterEach(() => {
    cleanup();
  });

  it('lets the reviewer exclude a blocking row without touching the CSV', async () => {
    const { restoreFileReader } = await renderPageToReview();
    try {
      expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(screen.getByTestId('review-expand-2'));
      // The raw source values are only revealed for the row the reviewer opened.
      expect(screen.getByTestId('row-preview-2').textContent).toContain('Unsupported Type');

      fireEvent.click(screen.getByTestId('row-ignore-2'));

      await waitFor(() => {
        expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(false);
      });
      expect(screen.getByTestId('override-summary').textContent).toContain('1 row changed by you');
    } finally {
      restoreFileReader();
    }
  });

  it('re-validates a row live when the reviewer corrects its Type', async () => {
    const { restoreFileReader } = await renderPageToReview();
    try {
      fireEvent.click(screen.getByTestId('review-expand-2'));
      fireEvent.click(screen.getByTestId('row-edit-2'));

      const typeField = screen.getByTestId('row-field-2-type');
      fireEvent.change(typeField, { target: { value: 'DIVIDEND' } });

      // The preview updates before anything is applied.
      await waitFor(() => {
        expect(screen.getByTestId('row-preview-2').textContent).toContain('imports as DIVIDEND');
      });

      fireEvent.click(screen.getByTestId('row-apply-2'));

      await waitFor(() => {
        expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(false);
      });
      // Edited rows stay flagged rather than silently passing.
      expect(screen.getByTestId('review-edited-2')).toBeTruthy();
    } finally {
      restoreFileReader();
    }
  });

  it('restores an ignored row and re-blocks the import', async () => {
    const { restoreFileReader } = await renderPageToReview();
    try {
      fireEvent.click(screen.getByTestId('review-expand-2'));
      fireEvent.click(screen.getByTestId('row-ignore-2'));
      await waitFor(() => {
        expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(false);
      });

      fireEvent.click(screen.getByTestId('row-restore-2'));
      await waitFor(() => {
        expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(true);
      });
      expect(screen.queryByTestId('override-summary')).toBeNull();
    } finally {
      restoreFileReader();
    }
  });

  it('resets every decision at once', async () => {
    const { restoreFileReader } = await renderPageToReview();
    try {
      fireEvent.click(screen.getByTestId('review-expand-2'));
      fireEvent.click(screen.getByTestId('row-ignore-2'));
      await waitFor(() => {
        expect(screen.getByTestId('override-summary')).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId('clear-overrides'));
      await waitFor(() => {
        expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(true);
      });
      expect(screen.queryByTestId('override-summary')).toBeNull();
    } finally {
      restoreFileReader();
    }
  });
});
