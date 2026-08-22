/** Provides the inspector shell and leaves each control group with its domain-specific component. */
import { useState, type ReactNode } from 'react';

interface StylePanelProps {
  children: ReactNode;
  editingEquation: boolean;
  inputMode: 'math' | 'text';
  onInputModeChange(mode: 'math' | 'text'): void;
  showInputMode: boolean;
}

export function StylePanel({
  children,
  editingEquation,
  inputMode,
  onInputModeChange,
  showInputMode,
}: StylePanelProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <aside
      className={mobileOpen ? 'style-panel is-open' : 'style-panel'}
      aria-label="Element style"
      data-keep-math-editor-open
      onPointerDown={(event) => {
        if (editingEquation && !(event.target instanceof HTMLInputElement)) {
          event.preventDefault();
        }
      }}
    >
      <button
        className="style-panel__toggle"
        type="button"
        aria-controls="element-style-controls"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? 'Close element style' : 'Open element style'}
        onClick={() => setMobileOpen((open) => !open)}
      >
        <span>Style</span>
        <span className="style-panel__disclosure" aria-hidden="true">
          {mobileOpen ? '⌄' : '⌃'}
        </span>
      </button>
      <div className="style-panel__content" id="element-style-controls">
        {showInputMode && (
          <>
            <span className="panel-label">Input mode</span>
            <div
              className="input-mode-options"
              role="group"
              aria-label="Input mode"
            >
              {(['text', 'math'] as const).map((mode) => (
                <button
                  type="button"
                  className={
                    inputMode === mode
                      ? 'input-mode-option is-active'
                      : 'input-mode-option'
                  }
                  aria-label={`Use ${mode} input mode`}
                  aria-pressed={inputMode === mode}
                  title={`${mode === 'text' ? 'Text' : 'Math'} input mode — Ctrl+M`}
                  key={mode}
                  onClick={() => onInputModeChange(mode)}
                >
                  {mode === 'text' ? 'Text' : 'Math'}
                </button>
              ))}
            </div>
          </>
        )}
        {children}
      </div>
    </aside>
  );
}
