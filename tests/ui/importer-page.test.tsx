/**
 * @vitest-environment jsdom
 */
import './setup';

import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { cleanupUi, renderPageToReconcile } from './helpers';

describe('Revolut importer page', () => {
  afterEach(() => {
    cleanupUi();
  });

  it('reaches reconcile and enables Import only after acknowledgement when every blocker is cleared', async () => {
    const { restoreFileReader } = await renderPageToReconcile();

    try {
      const importButton = await screen.findByTestId('import-button');
      const acknowledgeCheckbox = screen.getByTestId('acknowledge-checkbox');

      expect(importButton).toBeDisabled();
      expect(screen.getByText('Import is blocked')).toBeInTheDocument();

      fireEvent.click(acknowledgeCheckbox);

      expect(importButton).toBeEnabled();
    } finally {
      restoreFileReader();
    }
  });
});
