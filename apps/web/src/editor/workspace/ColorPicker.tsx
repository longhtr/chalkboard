/** HSV, RGB, and hex views over one normalized custom-color draft with explicit apply/cancel. */
import type { CSSProperties } from 'react';

import {
  hexToRgb,
  hsvToHex,
  normalizeHexColor,
  rgbToHex,
  type HsvColor,
  type RgbColor,
} from '../model/colorModel';
import { NumberInput } from './NumberInput';

interface ColorPickerProps {
  draft: string;
  hsv: HsvColor;
  onClose(): void;
  onHexChange(value: string): void;
  onHsvChange(change: Partial<HsvColor>): void;
  onRgbChange(change: Partial<RgbColor>): void;
  onSubmit(): void;
  target: 'stroke' | 'fill';
}

export function ColorPicker({
  draft,
  hsv,
  onClose,
  onHexChange,
  onHsvChange,
  onRgbChange,
  onSubmit,
  target,
}: ColorPickerProps) {
  const rgb = hexToRgb(hsvToHex(hsv));
  const normalizedDraft = normalizeHexColor(draft);

  return (
    <div
      className={
        target === 'fill'
          ? 'simple-color-picker is-fill-picker'
          : 'simple-color-picker'
      }
      role="dialog"
      aria-label="Add custom color"
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLInputElement &&
          event.target.type === 'number' &&
          (event.key === 'Enter' || event.key === 'Escape')
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.target.blur();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="hsv-color-controls">
        <ColorChannel
          label="Hue"
          maximum={360}
          shortLabel="H"
          sliderClassName="hsv-slider is-hue"
          value={hsv.hue}
          onChange={(hue) => onHsvChange({ hue })}
        />
        <ColorChannel
          label="Saturation"
          maximum={100}
          shortLabel="S"
          sliderStyle={
            {
              '--track': `linear-gradient(to right, #fff, ${hsvToHex({ ...hsv, saturation: 100 })})`,
            } as CSSProperties
          }
          value={hsv.saturation}
          onChange={(saturation) => onHsvChange({ saturation })}
        />
        <ColorChannel
          label="Value"
          maximum={100}
          shortLabel="V"
          sliderStyle={
            {
              '--track': `linear-gradient(to right, #000, ${hsvToHex({ ...hsv, value: 100 })})`,
            } as CSSProperties
          }
          value={hsv.value}
          onChange={(value) => onHsvChange({ value })}
        />
      </div>
      <div
        className="hsv-color-controls rgb-color-controls"
        aria-label="RGB values"
      >
        {(
          [
            ['red', 'R', 'Red'],
            ['green', 'G', 'Green'],
            ['blue', 'B', 'Blue'],
          ] as const
        ).map(([channel, shortLabel, label]) => (
          <ColorChannel
            key={channel}
            label={label}
            maximum={255}
            shortLabel={shortLabel}
            sliderStyle={
              {
                '--track': `linear-gradient(to right, ${rgbToHex({ ...rgb, [channel]: 0 })}, ${rgbToHex({ ...rgb, [channel]: 255 })})`,
              } as CSSProperties
            }
            value={rgb[channel]}
            onChange={(value) => onRgbChange({ [channel]: value })}
          />
        ))}
      </div>
      <div className="simple-color-picker__footer">
        <span>Hex</span>
        <span
          className="simple-color-picker__preview"
          style={
            {
              '--swatch': normalizedDraft ?? 'transparent',
            } as CSSProperties
          }
        />
        <input
          autoFocus
          type="text"
          className="simple-color-picker__hex-input"
          aria-label="Hex color"
          aria-invalid={normalizedDraft === null}
          maxLength={7}
          spellCheck={false}
          value={draft}
          onChange={(event) => onHexChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && normalizedDraft !== null) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={normalizedDraft === null}
          onClick={onSubmit}
        >
          Add
        </button>
      </div>
    </div>
  );
}

interface ColorChannelProps {
  label: string;
  maximum: number;
  onChange(value: number): void;
  shortLabel: string;
  sliderClassName?: string;
  sliderStyle?: CSSProperties;
  value: number;
}

function ColorChannel({
  label,
  maximum,
  onChange,
  shortLabel,
  sliderClassName = 'hsv-slider',
  sliderStyle,
  value,
}: ColorChannelProps) {
  return (
    <label className="hsv-color-control">
      <span>{shortLabel}</span>
      <input
        type="range"
        className={sliderClassName}
        aria-label={label}
        min="0"
        max={maximum}
        value={value}
        style={sliderStyle}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <NumberInput
        className="color-number-input"
        aria-label={`${label} value`}
        minimum={0}
        maximum={maximum}
        value={value}
        onValueChange={onChange}
      />
    </label>
  );
}
