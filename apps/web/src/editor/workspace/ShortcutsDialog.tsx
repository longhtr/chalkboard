/** Keyboard and touch reference grouped by tools, editing, and board actions. */
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
            <p>
              Use Ctrl on Windows and Linux, or ⌘ on macOS. Shortcuts are
              context-sensitive as listed below.
            </p>
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
        <p className="shortcut-history-note">
          Undo and redo target the open mixed block, otherwise the selected or
          just-created object. With empty Selection, they apply to the latest
          creation or deletion. They stop at another collaborator’s transaction
          and are disabled in Drag canvas.
        </p>
        <div className="shortcuts-dialog__sections">
          {/* Tools is short and Editing is long, so a plain grid row left a gap
              under Tools the width of half the dialog. Stacking the short
              sections in their own column fills it instead. */}
          <div className="shortcut-column">
            <section className="shortcut-section">
              <h3>Tools</h3>
              <dl>
                {toolLabels.map((label, index) => (
                  <div className="shortcut-row" key={label}>
                    <dt>
                      {label}
                      {label === 'Selection'
                        ? ' (press again to toggle Board objects)'
                        : ''}
                    </dt>
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
                  <dt>Switch between rendered and source editing</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>E</kbd>
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
                <div className="shortcut-row">
                  <dt>Select all writing</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>A</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Copy / cut / paste writing</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>C / X / V</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Complete a LaTeX command</dt>
                  <dd>
                    <kbd>Space</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Accept a command / start a row</dt>
                  <dd>
                    <kbd>Enter</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Move to the next placeholder</dt>
                  <dd>
                    <kbd>Tab</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Cancel an unfinished command</dt>
                  <dd>
                    <kbd>Escape</kbd>
                  </dd>
                </div>
              </dl>
            </section>
          </div>
          <div className="shortcut-column">
            <section className="shortcut-section">
              <h3>Editing</h3>
              <dl>
                <div className="shortcut-row">
                  <dt>Undo current history target</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>Z</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Redo current history target</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Z</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Redo current history target (alternative)</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>Y</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Copy selected objects</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>C</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Paste copied objects</dt>
                  <dd>
                    <kbd>Ctrl / ⌘</kbd>
                    <span>+</span>
                    <kbd>V</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Move selected objects (1 px; 10 px with Shift)</dt>
                  <dd>
                    <kbd>Arrow</kbd>
                    <span>/</span>
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Arrow</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Delete selection</dt>
                  <dd>
                    <kbd>Delete / Backspace</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Start the next connected Straight line</dt>
                  <dd>
                    <kbd>Space</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Finish path handle editing</dt>
                  <dd>
                    <kbd>Enter / Escape</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Constrain shape while drawing</dt>
                  <dd>
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Drag</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Keep proportions while resizing</dt>
                  <dd>
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Drag</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Snap rotation to 15°</dt>
                  <dd>
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Drag</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Add or remove from selection</dt>
                  <dd>
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Click</kbd>
                  </dd>
                </div>
              </dl>
            </section>
            <section className="shortcut-section">
              <h3>Board objects</h3>
              <dl>
                <div className="shortcut-row">
                  <dt>Add or remove from selection</dt>
                  <dd>
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Click</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Change layer order</dt>
                  <dd>
                    <kbd>Drag</kbd>
                  </dd>
                </div>
              </dl>
            </section>
            <section className="shortcut-section">
              <h3>Touch gestures</h3>
              <dl>
                <div className="shortcut-row">
                  <dt>Zoom and pan the board (Selection / Hand)</dt>
                  <dd>
                    <kbd>Two-finger pinch</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Add a connected Straight segment</dt>
                  <dd>
                    <kbd>Second-finger tap</kbd>
                  </dd>
                </div>
                <div className="shortcut-row">
                  <dt>Use Shift while drawing, resizing, or rotating</dt>
                  <dd>
                    <kbd>Hold second finger</kbd>
                  </dd>
                </div>
              </dl>
            </section>
          </div>
          <section className="shortcut-section shortcut-section--wide">
            <h3>Windows & dialogs</h3>
            <dl>
              <div className="shortcut-row">
                <dt>Close the active dialog or panel</dt>
                <dd>
                  <kbd>Escape</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Apply / dismiss a custom color</dt>
                <dd>
                  <kbd>Enter / Escape</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Commit / revert a numeric field</dt>
                <dd>
                  <kbd>Enter / Escape</kbd>
                </dd>
              </div>
              <div className="shortcut-row">
                <dt>Remove a focused custom color</dt>
                <dd>
                  <kbd>Delete / Backspace</kbd>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}
