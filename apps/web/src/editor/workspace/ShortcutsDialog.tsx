/** Keyboard-command reference grouped by navigation, tools, editing, and board actions. */
import { useModalFocus } from '../../components/useModalFocus';

interface ShortcutsDialogProps {
  onClose(): void;
  open: boolean;
  toolLabels: string[];
}

export function ShortcutsDialog({
  onClose,
  open,
  toolLabels,
}: ShortcutsDialogProps) {
  const dialogRef = useModalFocus<HTMLElement>(open);
  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <header className="shortcuts-dialog__header">
          <div>
            <h2 id="shortcuts-title">Keyboard shortcuts</h2>
            <p>Use Ctrl on Windows and Linux, or ⌘ on macOS.</p>
          </div>
          <button
            type="button"
            className="shortcuts-dialog__close"
            aria-label="Close keyboard shortcuts"
            data-dialog-autofocus
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="shortcuts-dialog__sections">
          <section className="shortcut-section">
            <h3>Tools</h3>
            <dl>
              {toolLabels.map((label, index) => (
                <div className="shortcut-row" key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>{index + 1}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="shortcut-section">
            <h3>Editing</h3>
            <dl>
              <div className="shortcut-row">
                <dt>Undo</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <span>+</span>
                  <kbd>Z</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Redo</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>Z</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Copy selection</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <span>+</span>
                  <kbd>C</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Paste selection</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <span>+</span>
                  <kbd>V</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Delete selection</dt>
                <dd>
                  <kbd>Delete</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Constrain shape</dt>
                <dd>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>Drag</kbd>
                </dd>
              </div>
            </dl>
          </section>
          <section className="shortcut-section shortcut-section--wide">
            <h3>Mixed text</h3>
            <dl>
              <div className="shortcut-row">
                <dt>Switch input mode</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd>
                  <span>+</span>
                  <kbd>M</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Previous / next typing color</dt>
                <dd>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>J / K</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Decrease / increase text size</dt>
                <dd>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>- / =</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Decrease / increase line spacing</dt>
                <dd>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>[ / ]</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Navigate between blocks</dt>
                <dd>
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>Arrow</kbd>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}
