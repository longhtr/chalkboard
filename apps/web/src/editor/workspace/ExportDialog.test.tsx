/** Proves Export image explains selection scope without changing disabled-cursor behavior. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportDialog } from './ExportDialog';

const selectionHelp =
  'Exports only selected board objects. This option is available when one or more objects are selected before opening Export image.';

afterEach(cleanup);

describe('ExportDialog', () => {
  it('explains the disabled Selection option on hover', () => {
    render(
      <ExportDialog
        canExportSelection={false}
        onClose={vi.fn()}
        onExport={vi.fn(async () => undefined)}
        open
      />,
    );

    const selection = screen.getByRole('radio', { name: 'Selection' });
    const option = selection.closest('label');
    expect(selection).toBeDisabled();
    expect(selection).toHaveAttribute(
      'aria-describedby',
      'export-selection-help',
    );
    expect(option).toHaveClass('is-disabled');
    expect(screen.getByText(selectionHelp)).toHaveClass('sr-only');

    fireEvent.mouseEnter(option as HTMLLabelElement);
    expect(document.querySelector('.export-option-tooltip')).toHaveTextContent(
      selectionHelp,
    );

    fireEvent.mouseLeave(option as HTMLLabelElement);
    expect(document.querySelector('.export-option-tooltip')).toBeNull();
  });

  it('shows the same explanation when an available Selection option is focused', () => {
    render(
      <ExportDialog
        canExportSelection
        onClose={vi.fn()}
        onExport={vi.fn(async () => undefined)}
        open
      />,
    );

    const selection = screen.getByRole('radio', { name: 'Selection' });
    expect(selection).toBeEnabled();
    fireEvent.focus(selection);
    expect(document.querySelector('.export-option-tooltip')).toHaveTextContent(
      selectionHelp,
    );
  });
});
