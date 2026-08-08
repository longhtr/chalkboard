/** Collects export format/background/scale and presents cancellable progress without performing export itself. */
import { useState } from 'react';

import { useModalFocus } from '../../components/useModalFocus';
import type {
  BoardExportFormat,
  BoardExportOptions,
  BoardExportScope,
} from '../portability/boardExport';
import { NumberInput } from './NumberInput';

const MAX_EXPORT_PADDING = 256;
const PADDING_SIDES = ['top', 'right', 'bottom', 'left'] as const;

interface ExportDialogProps {
  canExportSelection: boolean;
  onClose(): void;
  onExport(options: BoardExportOptions): Promise<void>;
  open: boolean;
}

export function ExportDialog({
  canExportSelection,
  onClose,
  onExport,
  open,
}: ExportDialogProps) {
  const [format, setFormat] = useState<BoardExportFormat>('png');
  const [scope, setScope] = useState<BoardExportScope>('board');
  const [background, setBackground] = useState(true);
  const [padding, setPadding] = useState({
    bottom: 24,
    left: 24,
    right: 24,
    top: 24,
  });
  const [scale, setScale] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const dialogRef = useModalFocus<HTMLElement>(open);
  const effectiveScope = canExportSelection ? scope : 'board';

  if (!open) return null;

  const submit = async () => {
    setExporting(true);
    setError(null);
    try {
      await onExport({
        background,
        format,
        padding,
        scale,
        scope: effectiveScope,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !exporting) onClose();
      }}
    >
      <section
        ref={dialogRef}
        aria-labelledby="export-title"
        aria-modal="true"
        className="export-dialog"
        role="dialog"
      >
        <header className="shortcuts-dialog__header">
          <div>
            <h2 id="export-title">Export image</h2>
            <p>Download a portable image of the whole board or selection.</p>
          </div>
          <button
            aria-label="Close export"
            className="shortcuts-dialog__close"
            data-dialog-autofocus
            disabled={exporting}
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="export-dialog__body">
          <fieldset>
            <legend>File type</legend>
            <div className="export-option-row">
              {(['png', 'svg'] as const).map((value) => (
                <label key={value}>
                  <input
                    checked={format === value}
                    name="export-format"
                    onChange={() => setFormat(value)}
                    type="radio"
                  />
                  {value.toUpperCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Area</legend>
            <div className="export-option-row">
              <label>
                <input
                  checked={effectiveScope === 'board'}
                  name="export-scope"
                  onChange={() => setScope('board')}
                  type="radio"
                />
                Whole board
              </label>
              <label className={canExportSelection ? '' : 'is-disabled'}>
                <input
                  checked={effectiveScope === 'selection'}
                  disabled={!canExportSelection}
                  name="export-scope"
                  onChange={() => setScope('selection')}
                  type="radio"
                />
                Selection
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Padding (px)</legend>
            <div className="export-padding__grid">
              {PADDING_SIDES.map((side) => (
                <label key={side}>
                  <span>{side[0]?.toUpperCase() + side.slice(1)}</span>
                  <NumberInput
                    aria-label={`${side[0]?.toUpperCase() + side.slice(1)} export padding`}
                    className="shape-number-input"
                    minimum={0}
                    maximum={MAX_EXPORT_PADDING}
                    step="1"
                    value={padding[side]}
                    onValueChange={(value) =>
                      setPadding((current) => ({
                        ...current,
                        [side]: Math.round(value),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <label className="export-checkbox">
            <input
              checked={background}
              onChange={(event) => setBackground(event.currentTarget.checked)}
              type="checkbox"
            />
            Include board background
          </label>
          {format === 'png' ? (
            <label className="export-scale">
              PNG resolution
              <select
                aria-label="PNG resolution"
                value={scale}
                onChange={(event) =>
                  setScale(Number(event.currentTarget.value))
                }
              >
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="3">3×</option>
              </select>
            </label>
          ) : null}
          {error !== null ? (
            <p className="export-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="export-dialog__actions">
            <button disabled={exporting} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              aria-live="polite"
              className="export-primary"
              disabled={exporting}
              onClick={() => void submit()}
              type="button"
            >
              {exporting ? 'Preparing…' : `Export ${format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
