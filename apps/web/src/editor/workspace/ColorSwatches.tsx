/** Preset and user-saved color choices with explicit custom-color removal controls. */
import type { CSSProperties } from 'react';

interface ColorSwatchesProps {
  activeColor: string;
  colors: string[];
  defaultColors: readonly string[];
  kind: 'fill' | 'stroke' | 'text';
  onChange(color: string): void;
  onRemove(color: string): void;
  onTogglePicker(): void;
  pickerOpen: boolean;
}

export function ColorSwatches({
  activeColor,
  colors,
  defaultColors,
  kind,
  onChange,
  onRemove,
  onTogglePicker,
  pickerOpen,
}: ColorSwatchesProps) {
  const isFill = kind === 'fill';
  const colorRole = {
    fill: 'fill',
    stroke: 'stroke',
    text: 'text color',
  }[kind];
  return (
    <div className="swatches">
      {colors.map((color) => {
        const isCustom =
          color !== 'transparent' && !defaultColors.includes(color);
        const useLabel =
          color === 'transparent' && !isFill
            ? 'Use no stroke'
            : `Use ${color} ${colorRole}`;
        const removeLabel = isFill
          ? `Remove ${color} fill color`
          : `Remove ${color} color`;
        return (
          <div className="color-swatch-item" key={color}>
            <button
              type="button"
              className={activeColor === color ? 'swatch is-active' : 'swatch'}
              aria-label={useLabel}
              style={{ '--swatch': color } as CSSProperties}
              onClick={() => onChange(color)}
              onKeyDown={(event) => {
                if (
                  isCustom &&
                  (event.key === 'Delete' || event.key === 'Backspace')
                ) {
                  event.preventDefault();
                  onRemove(color);
                }
              }}
            />
            {isCustom && (
              <button
                type="button"
                className="remove-color-button"
                aria-label={removeLabel}
                onClick={() => onRemove(color)}
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="add-color-button"
        aria-label={isFill ? 'Add fill color' : 'Add color'}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        onClick={onTogglePicker}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
