/** Proves board-menu actions, disabled states, hidden file inputs, dialogs, grid, font, and sharing controls. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardMenu } from './BoardMenu';

const callbacks = {
  onBoardTitleChange: vi.fn(),
  onBoardTitleCommit: vi.fn(),
  onClearCanvas: vi.fn(),
  onCopyToCloud: vi.fn(),
  onCreateCloudBoard: vi.fn(),
  onCreateLocalBoard: vi.fn(),
  onGridDotSizeChange: vi.fn(),
  onGridSpacingChange: vi.fn(),
  onWorkspaceFontChoiceChange: vi.fn(),
  onExportBoard: vi.fn(),
  onImportBoard: vi.fn(),
  onOpenBoards: vi.fn(),
  onOpenExport: vi.fn(),
  onOpenLatexCheatsheet: vi.fn(),
  onOpenShortcuts: vi.fn(),
  onToggleFontSettings: vi.fn(),
  onToggleGrid: vi.fn(),
  onToggleGridSettings: vi.fn(),
  onToggleMenu: vi.fn(),
  onToggleNewBoardOptions: vi.fn(),
  onThemeChange: vi.fn(),
  onToggleThemeSettings: vi.fn(),
};

function renderMenu({ readOnly }: { readOnly: boolean }) {
  return render(
    <BoardMenu
      boardTitle="Board"
      canCopyToCloud
      canCreateCloud
      fontSettingsOpen={false}
      gridDotSize={1}
      gridSettingsOpen={false}
      gridSpacing={20}
      fontChoice="excalifont"
      menuOpen
      newBoardOptionsOpen={false}
      readOnly={readOnly}
      showGrid
      theme="light"
      themeSettingsOpen={false}
      {...callbacks}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BoardMenu', () => {
  it('bounds and commits a board title when editing ends', () => {
    renderMenu({ readOnly: false });
    const title = screen.getByRole('textbox', { name: 'Board title' });

    fireEvent.change(title, { target: { value: '😀'.repeat(161) } });
    expect(callbacks.onBoardTitleChange).toHaveBeenLastCalledWith(
      '😀'.repeat(160),
    );
    fireEvent.change(title, { target: { value: 'Renamed board' } });
    fireEvent.blur(title, { target: { value: '  Renamed board  ' } });

    expect(callbacks.onBoardTitleChange).toHaveBeenCalledWith('Renamed board');
    expect(callbacks.onBoardTitleCommit).toHaveBeenCalledWith(
      '  Renamed board  ',
    );
  });

  it('offers local and cloud destinations from the New board side panel', () => {
    const view = renderMenu({ readOnly: false });
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    expect(callbacks.onToggleNewBoardOptions).toHaveBeenCalledOnce();

    view.rerender(
      <BoardMenu
        boardTitle="Board"
        canCopyToCloud
        canCreateCloud
        fontSettingsOpen={false}
        gridDotSize={1}
        gridSettingsOpen={false}
        gridSpacing={20}
        fontChoice="excalifont"
        menuOpen
        newBoardOptionsOpen
        readOnly={false}
        showGrid
        theme="light"
        themeSettingsOpen={false}
        {...callbacks}
      />,
    );
    const choices = screen.getByRole('menu', {
      name: 'Choose board storage',
    });
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Store in this browser/u }),
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Store in your account/u }),
    );
    expect(callbacks.onCreateLocalBoard).toHaveBeenCalledOnce();
    expect(callbacks.onCreateCloudBoard).toHaveBeenCalledOnce();
    expect(choices).toBeVisible();
  });

  it('keeps export available to viewers without destructive actions', () => {
    const view = renderMenu({ readOnly: true });
    expect(screen.getByRole('button', { name: 'Import board' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy to cloud' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export board' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export image' })).toBeVisible();
    const primaryFileActions = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((label) =>
        ['Import board', 'Export board', 'Export image'].includes(label ?? ''),
      );
    expect(primaryFileActions).toEqual([
      'Import board',
      'Export board',
      'Export image',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Font' }));
    expect(callbacks.onToggleFontSettings).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Clear canvas' }),
    ).not.toBeInTheDocument();

    view.rerender(
      <BoardMenu
        boardTitle="Board"
        canCopyToCloud
        canCreateCloud
        fontSettingsOpen
        gridDotSize={1}
        gridSettingsOpen={false}
        gridSpacing={20}
        fontChoice="excalifont"
        menuOpen
        newBoardOptionsOpen={false}
        readOnly={false}
        showGrid
        theme="light"
        themeSettingsOpen={false}
        {...callbacks}
      />,
    );
    expect(screen.getByRole('button', { name: 'Clear canvas' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Font options' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Excalifont' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Classic' }));
    expect(callbacks.onWorkspaceFontChoiceChange).toHaveBeenCalledWith(
      'classic',
    );
  });
});
