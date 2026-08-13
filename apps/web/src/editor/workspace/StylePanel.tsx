/** Provides the inspector shell and leaves each control group with its domain-specific component. */
import type { ReactNode } from 'react';

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
  return (
    <aside
      className="style-panel"
      aria-label="Element style"
      data-keep-math-editor-open
      onPointerDown={(event) => {
        if (editingEquation && !(event.target instanceof HTMLInputElement)) {
          event.preventDefault();
        }
      }}
    >
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
    </aside>
  );
}
