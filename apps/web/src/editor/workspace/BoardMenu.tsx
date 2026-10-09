/**
 * Board-level command menu for import/export, confirmed canvas clearing, grid,
 * font, sharing, reference, and new-board actions. Hidden file inputs remain
 * owned by the workspace.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from '../../components/Icon';
import type { Theme } from './theme';
import type { GridStyle } from '../interaction/rendering';
import { truncateBoardTitle } from '../model/boardTitle';
import {
  MAX_GRID_DOT_SIZE,
  MAX_GRID_SPACING,
  MIN_GRID_DOT_SIZE,
  MIN_GRID_SPACING,
} from '../model/limits';
import type { WorkspaceFontChoice } from '../../math/workspaceFontAssets';

/** Menu labels for each theme, in the order the control shows them. */
const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
};

interface BoardMenuProps {
  boardTitle: string;
  canCopyToCloud: boolean;
  canCreateCloud: boolean;
  children?: ReactNode;
  fontSettingsOpen: boolean;
  gridDotSize: number;
  gridLineOpacity: number;
  gridSettingsOpen: boolean;
  gridSpacing: number;
  gridStyle: GridStyle;
  fontChoice: WorkspaceFontChoice;
  menuOpen: boolean;
  newBoardOptionsOpen: boolean;
  onBoardTitleChange(title: string): void;
  onBoardTitleCommit(title: string): void;
  onClearCanvas(): void;
  onCopyToCloud(): void;
  onCreateCloudBoard(): void;
  onCreateLocalBoard(): void;
  onGridDotSizeChange(size: number): void;
  onGridLineOpacityChange(opacity: number): void;
  onGridSpacingChange(spacing: number): void;
  onGridStyleChange(style: GridStyle): void;
  onWorkspaceFontChoiceChange(choice: WorkspaceFontChoice): void;
  onExportBoard(): void;
  onImportBoard(): void;
  onOpenBoardInvites(): void;
  onOpenBoards(): void;
  onOpenExport(): void;
  onOpenLatexCheatsheet(): void;
  onOpenShortcuts(): void;
  onToggleFontSettings(): void;
  onToggleGrid(): void;
  onToggleGridSettings(): void;
  onToggleMenu(): void;
  onToggleNewBoardOptions(): void;
  onThemeChange(theme: Theme): void;
  onToggleThemeSettings(): void;
  readOnly: boolean;
  showGrid: boolean;
  theme: Theme;
  themeSettingsOpen: boolean;
}

function ClearCanvasMenuItem({ onClearCanvas }: { onClearCanvas(): void }) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmationOpen) cancelRef.current?.focus();
  }, [confirmationOpen]);

  return (
    <div className="board-menu-submenu">
      <button
        ref={buttonRef}
        aria-controls="clear-canvas-confirmation"
        aria-expanded={confirmationOpen}
        aria-haspopup="dialog"
        className={
          confirmationOpen
            ? 'menu-item menu-item--danger is-open'
            : 'menu-item menu-item--danger'
        }
        type="button"
        onClick={() => setConfirmationOpen(true)}
      >
        <Icon name="trash" />
        <span>Clear canvas</span>
      </button>
      {confirmationOpen ? (
        <div
          aria-describedby="clear-canvas-description"
          aria-labelledby="clear-canvas-title"
          className="clear-canvas-popover"
          id="clear-canvas-confirmation"
          role="alertdialog"
        >
          <strong id="clear-canvas-title">Clear this canvas?</strong>
          <p id="clear-canvas-description">
            Every item on the current board will be removed.
          </p>
          <div className="clear-canvas-popover__actions">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => {
                setConfirmationOpen(false);
                buttonRef.current?.focus();
              }}
            >
              Cancel
            </button>
            <button
              className="is-danger"
              type="button"
              onClick={() => {
                setConfirmationOpen(false);
                onClearCanvas();
              }}
            >
              Clear canvas
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BoardMenu({
  boardTitle,
  canCopyToCloud,
  canCreateCloud,
  children,
  fontSettingsOpen,
  gridDotSize,
  gridLineOpacity,
  gridSettingsOpen,
  gridSpacing,
  gridStyle,
  fontChoice,
  menuOpen,
  newBoardOptionsOpen,
  onBoardTitleChange,
  onBoardTitleCommit,
  onClearCanvas,
  onCopyToCloud,
  onCreateCloudBoard,
  onCreateLocalBoard,
  onGridDotSizeChange,
  onGridLineOpacityChange,
  onGridSpacingChange,
  onGridStyleChange,
  onWorkspaceFontChoiceChange,
  onExportBoard,
  onImportBoard,
  onOpenBoardInvites,
  onOpenBoards,
  onOpenExport,
  onOpenLatexCheatsheet,
  onOpenShortcuts,
  onToggleFontSettings,
  onToggleGrid,
  onToggleGridSettings,
  onToggleMenu,
  onToggleNewBoardOptions,
  onThemeChange,
  onToggleThemeSettings,
  readOnly,
  showGrid,
  theme,
  themeSettingsOpen,
}: BoardMenuProps) {
  return (
    <div className="workspace-top-left">
      <div className="board-controls">
        <button
          className="icon-button menu-button"
          type="button"
          aria-label="Open board menu"
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
        >
          <Icon name="menu" />
        </button>
        <input
          className="board-title"
          aria-label="Board title"
          value={boardTitle}
          readOnly={readOnly}
          onBlur={(event) => onBoardTitleCommit(event.target.value)}
          onChange={(event) =>
            onBoardTitleChange(truncateBoardTitle(event.target.value))
          }
        />
      </div>
      {menuOpen ? (
        <div className="board-menu">
          {canCreateCloud ? (
            <div className="board-menu-submenu">
              <button
                className={
                  newBoardOptionsOpen ? 'menu-item is-open' : 'menu-item'
                }
                type="button"
                aria-expanded={newBoardOptionsOpen}
                aria-haspopup="menu"
                onClick={onToggleNewBoardOptions}
              >
                <Icon name="new-board" />
                <span>New board</span>
                <span aria-hidden="true">›</span>
              </button>
              {newBoardOptionsOpen ? (
                <div
                  className="new-board-popover"
                  role="menu"
                  aria-label="Choose board storage"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onCreateLocalBoard}
                  >
                    <strong>Local</strong>
                    <span>Store in this browser</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onCreateCloudBoard}
                  >
                    <strong>Cloud</strong>
                    <span>Store in your account</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button
              className="menu-item"
              type="button"
              onClick={onCreateLocalBoard}
            >
              <Icon name="new-board" />
              <span>New board</span>
            </button>
          )}
          <button className="menu-item" type="button" onClick={onOpenBoards}>
            <Icon name="folder-open" />
            <span>Open boards</span>
          </button>
          <button
            className="menu-item"
            type="button"
            aria-haspopup="dialog"
            onClick={onOpenBoardInvites}
          >
            <Icon name="folder-open" />
            <span>Board invites</span>
          </button>
          <button className="menu-item" type="button" onClick={onImportBoard}>
            <Icon name="import" />
            <span>Import board</span>
          </button>
          <button className="menu-item" type="button" onClick={onExportBoard}>
            <Icon name="export" />
            <span>Export board</span>
          </button>
          <button
            className="menu-item"
            type="button"
            aria-haspopup="dialog"
            onClick={onOpenExport}
          >
            <Icon name="image" />
            <span>Export image</span>
          </button>
          {!readOnly ? (
            <ClearCanvasMenuItem onClearCanvas={onClearCanvas} />
          ) : null}
          <span className="board-menu-separator" aria-hidden="true" />
          <div className="board-menu-submenu">
            <button
              className={gridSettingsOpen ? 'menu-item is-open' : 'menu-item'}
              type="button"
              aria-label="Grid"
              aria-controls="grid-settings-popover"
              aria-expanded={gridSettingsOpen}
              aria-haspopup="dialog"
              onClick={onToggleGridSettings}
            >
              <Icon name="grid" />
              <span>Grid</span>
              <span className="menu-disclosure">
                {showGrid ? (gridStyle === 'dots' ? 'Dots' : 'Lines') : 'Off'}
                <span aria-hidden="true">›</span>
              </span>
            </button>
            {gridSettingsOpen ? (
              <div
                className="grid-settings-popover"
                id="grid-settings-popover"
                role="dialog"
                aria-label="Grid options"
              >
                <div className="grid-popover-header">
                  <span className="grid-subpanel-title">Grid</span>
                  <button
                    className="board-menu-switch"
                    type="button"
                    role="switch"
                    aria-checked={showGrid}
                    aria-label="Grid"
                    onClick={onToggleGrid}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
                <div className="board-choice-setting">
                  <div
                    className="board-choice-options"
                    role="group"
                    aria-label="Grid style"
                  >
                    {(
                      [
                        ['dots', 'Dots'],
                        ['lines', 'Lines'],
                      ] as const
                    ).map(([style, label]) => (
                      <button
                        type="button"
                        className={
                          gridStyle === style
                            ? 'board-choice-option is-active'
                            : 'board-choice-option'
                        }
                        aria-pressed={gridStyle === style}
                        key={style}
                        onClick={() => onGridStyleChange(style)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="board-menu-setting">
                  <div className="board-menu-setting__control">
                    <div className="board-menu-setting__header">
                      <label htmlFor="grid-spacing">Spacing</label>
                      <output htmlFor="grid-spacing">{gridSpacing}px</output>
                    </div>
                    <input
                      id="grid-spacing"
                      aria-label="Grid spacing"
                      type="range"
                      min={MIN_GRID_SPACING}
                      max={MAX_GRID_SPACING}
                      step="1"
                      value={gridSpacing}
                      onChange={(event) =>
                        onGridSpacingChange(Number(event.currentTarget.value))
                      }
                    />
                  </div>
                  {gridStyle === 'dots' ? (
                    <div className="board-menu-setting__control">
                      <div className="board-menu-setting__header">
                        <label htmlFor="grid-dot-size">Dot size</label>
                        <output htmlFor="grid-dot-size">{gridDotSize}px</output>
                      </div>
                      <input
                        id="grid-dot-size"
                        aria-label="Grid dot size"
                        type="range"
                        min={MIN_GRID_DOT_SIZE}
                        max={MAX_GRID_DOT_SIZE}
                        step="0.25"
                        value={gridDotSize}
                        onChange={(event) =>
                          onGridDotSizeChange(Number(event.currentTarget.value))
                        }
                      />
                    </div>
                  ) : (
                    <div className="board-menu-setting__control">
                      <div className="board-menu-setting__header">
                        <label htmlFor="grid-line-opacity">Line opacity</label>
                        <output htmlFor="grid-line-opacity">
                          {Math.round(gridLineOpacity * 100)}%
                        </output>
                      </div>
                      <input
                        id="grid-line-opacity"
                        aria-label="Grid line opacity"
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={gridLineOpacity}
                        onChange={(event) =>
                          onGridLineOpacityChange(
                            Number(event.currentTarget.value),
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="board-menu-submenu">
            <button
              className={fontSettingsOpen ? 'menu-item is-open' : 'menu-item'}
              type="button"
              aria-label="Font"
              aria-controls="font-settings-popover"
              aria-expanded={fontSettingsOpen}
              aria-haspopup="dialog"
              onClick={onToggleFontSettings}
            >
              <Icon name="text" />
              <span>Font</span>
              <span className="menu-disclosure">
                {fontChoice === 'excalifont' ? 'Excalifont' : 'Classic'}
                <span aria-hidden="true">›</span>
              </span>
            </button>
            {fontSettingsOpen ? (
              <div
                className="grid-settings-popover"
                id="font-settings-popover"
                role="dialog"
                aria-label="Font options"
              >
                <div className="grid-popover-header">
                  <span className="grid-subpanel-title">Font</span>
                </div>
                <div className="board-choice-setting">
                  <div
                    className="board-choice-options"
                    role="group"
                    aria-label="Font"
                  >
                    {(
                      [
                        ['excalifont', 'Excalifont'],
                        ['classic', 'Classic'],
                      ] as const
                    ).map(([choice, label]) => (
                      <button
                        type="button"
                        className={
                          fontChoice === choice
                            ? 'board-choice-option is-active'
                            : 'board-choice-option'
                        }
                        aria-pressed={fontChoice === choice}
                        key={choice}
                        onClick={() => onWorkspaceFontChoiceChange(choice)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="board-menu-submenu">
            <button
              className={themeSettingsOpen ? 'menu-item is-open' : 'menu-item'}
              type="button"
              aria-label="Theme"
              aria-controls="theme-settings-popover"
              aria-expanded={themeSettingsOpen}
              aria-haspopup="dialog"
              onClick={onToggleThemeSettings}
            >
              <Icon name="theme" />
              <span>Theme</span>
              <span className="menu-disclosure">
                {THEME_LABELS[theme]}
                <span aria-hidden="true">›</span>
              </span>
            </button>
            {themeSettingsOpen ? (
              <div
                className="grid-settings-popover"
                id="theme-settings-popover"
                role="dialog"
                aria-label="Theme options"
              >
                <div className="grid-popover-header">
                  <span className="grid-subpanel-title">Theme</span>
                </div>
                <div className="board-choice-setting">
                  <div
                    className="board-choice-options"
                    role="group"
                    aria-label="Theme"
                  >
                    {(['light', 'dark'] as const).map((choice) => (
                      <button
                        type="button"
                        className={
                          theme === choice
                            ? 'board-choice-option is-active'
                            : 'board-choice-option'
                        }
                        aria-pressed={theme === choice}
                        key={choice}
                        onClick={() => onThemeChange(choice)}
                      >
                        {THEME_LABELS[choice]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {canCopyToCloud ? (
            <button className="menu-item" type="button" onClick={onCopyToCloud}>
              <Icon name="upload" />
              <span>Copy to cloud</span>
            </button>
          ) : null}
          <button
            className="menu-item"
            type="button"
            aria-haspopup="dialog"
            onClick={onOpenShortcuts}
          >
            <Icon name="keyboard" />
            <span>Keyboard shortcuts</span>
          </button>
          <button
            className="menu-item"
            type="button"
            aria-haspopup="dialog"
            onClick={onOpenLatexCheatsheet}
          >
            <Icon name="equation" />
            <span>MathLive / LaTeX cheatsheet</span>
          </button>
          <a className="menu-item" href="mailto:support@chalkboard.space">
            <Icon name="mail" />
            <span>Contact</span>
          </a>
        </div>
      ) : null}
      {children}
    </div>
  );
}
