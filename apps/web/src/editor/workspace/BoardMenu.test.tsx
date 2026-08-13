/** Proves board-menu order, destructive confirmation, actions, dialogs, grid, font, information, and sharing controls. */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
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
  onGridLineOpacityChange: vi.fn(),
  onGridSpacingChange: vi.fn(),
  onGridStyleChange: vi.fn(),
  onWorkspaceFontChoiceChange: vi.fn(),
  onExportBoard: vi.fn(),
  onImportBoard: vi.fn(),
  onOpenBoards: vi.fn(),
  onOpenExport: vi.fn(),
  onOpenLatexCheatsheet: vi.fn(),
  onOpenPublicInformation: vi.fn(),
  onOpenShortcuts: vi.fn(),
  onToggleFontSettings: vi.fn(),
  onToggleGrid: vi.fn(),
  onToggleGridSettings: vi.fn(),
  onToggleInformationOptions: vi.fn(),
  onToggleMenu: vi.fn(),
  onToggleNewBoardOptions: vi.fn(),
  onThemeChange: vi.fn(),
  onToggleThemeSettings: vi.fn(),
};

function renderMenu({
  gridSettingsOpen = false,
  gridStyle = 'dots',
  informationOptionsOpen = false,
  readOnly,
}: {
  gridSettingsOpen?: boolean;
  gridStyle?: 'dots' | 'lines';
  informationOptionsOpen?: boolean;
  readOnly: boolean;
}) {
  return render(
    <BoardMenu
      boardTitle="Board"
      canCopyToCloud
      canCreateCloud
      fontSettingsOpen={false}
      gridDotSize={1}
      gridLineOpacity={0.3}
      gridSettingsOpen={gridSettingsOpen}
      gridSpacing={20}
      gridStyle={gridStyle}
      fontChoice="excalifont"
      informationOptionsOpen={informationOptionsOpen}
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
        gridLineOpacity={0.3}
        gridSettingsOpen={false}
        gridSpacing={20}
        gridStyle="dots"
        fontChoice="excalifont"
        informationOptionsOpen={false}
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

  it('switches between dotted and line grids', () => {
    renderMenu({ gridSettingsOpen: true, gridStyle: 'lines', readOnly: false });

    expect(screen.getByRole('dialog', { name: 'Grid options' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByLabelText('Grid dot size')).not.toBeInTheDocument();
    const opacity = screen.getByLabelText('Grid line opacity');
    expect(opacity).toHaveValue('0.3');
    fireEvent.change(opacity, { target: { value: '0.55' } });
    expect(callbacks.onGridLineOpacityChange).toHaveBeenCalledWith(0.55);
    fireEvent.click(screen.getByRole('button', { name: 'Dots' }));
    expect(callbacks.onGridStyleChange).toHaveBeenCalledWith('dots');
  });

  it('opens each public-information destination from one menu group', () => {
    renderMenu({ informationOptionsOpen: true, readOnly: false });

    const menu = screen.getByRole('menu', { name: 'Public information' });
    expect(menu).toBeVisible();
    expect(menu).toHaveClass('information-popover');
    const information = screen.getByRole('button', { name: 'Information' });
    expect(information.parentElement?.previousElementSibling).not.toHaveClass(
      'board-menu-separator',
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual([
      'Privacy',
      'Terms',
      'Acceptable use',
      'Retention',
      'Account deletion',
      'Contact',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Acceptable use' }));
    expect(callbacks.onOpenPublicInformation).toHaveBeenCalledWith(
      '/acceptable-use',
    );
    expect(callbacks.onToggleInformationOptions).not.toHaveBeenCalled();
    expect(menu).toBeVisible();
  });

  it('places Clear canvas below Export image and requires confirmation', () => {
    renderMenu({ readOnly: false });
    const exportImage = screen.getByRole('button', { name: 'Export image' });
    const clearCanvas = screen.getByRole('button', { name: 'Clear canvas' });
    expect(
      exportImage.compareDocumentPosition(clearCanvas) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(clearCanvas);
    expect(callbacks.onClearCanvas).not.toHaveBeenCalled();
    let confirmation = screen.getByRole('alertdialog', {
      name: 'Clear this canvas?',
    });
    expect(
      within(confirmation).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Cancel' }),
    );
    expect(callbacks.onClearCanvas).not.toHaveBeenCalled();
    expect(clearCanvas).toHaveFocus();

    fireEvent.click(clearCanvas);
    confirmation = screen.getByRole('alertdialog', {
      name: 'Clear this canvas?',
    });
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Clear canvas' }),
    );
    expect(callbacks.onClearCanvas).toHaveBeenCalledOnce();
  });

  it('keeps export available to viewers without destructive actions', () => {
    const view = renderMenu({ readOnly: true });
    expect(screen.getByRole('button', { name: 'Import board' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy to cloud' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export board' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export image' })).toBeVisible();
    const information = screen.getByRole('button', { name: 'Information' });
    expect(information).toBeVisible();
    fireEvent.click(information);
    expect(callbacks.onToggleInformationOptions).toHaveBeenCalledOnce();
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
        gridLineOpacity={0.3}
        gridSettingsOpen={false}
        gridSpacing={20}
        gridStyle="dots"
        fontChoice="excalifont"
        informationOptionsOpen={false}
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
