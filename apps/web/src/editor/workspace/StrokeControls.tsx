/** Inspector controls for stroke width/style, opacity, and stroke/fill color palettes. */
import {
  MAX_STROKE_DASH_GAP,
  MIN_STROKE_DASH_GAP,
  strokeDashGap,
  type ElementStyle,
  type LineArrowheads,
  type ShapeKind,
} from '@chalkboard/shared';

import { Icon } from '../../components/Icon';
import { NumberInput } from './NumberInput';

const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 12;
const MAX_CORNER_RADIUS = 100;

interface StrokeControlsProps {
  arrowheads: LineArrowheads;
  cornerRadius: number;
  isLine: boolean;
  isOrthogonalLine: boolean;
  isShape: boolean;
  onArrowheadsChange(arrowheads: LineArrowheads): void;
  onCornerRadiusChange(radius: number): void;
  onCornerRadiusGestureChange(phase: 'finish' | 'start'): void;
  onStrokeDashGapChange(gap: number): void;
  onStrokeDashGapGestureChange(phase: 'finish' | 'start'): void;
  onStyleChange(change: Partial<ElementStyle>): void;
  shapeKind: ShapeKind;
  style: ElementStyle;
}

export function StrokeControls({
  arrowheads,
  cornerRadius,
  isLine,
  isOrthogonalLine,
  isShape,
  onArrowheadsChange,
  onCornerRadiusChange,
  onCornerRadiusGestureChange,
  onStrokeDashGapChange,
  onStrokeDashGapGestureChange,
  onStyleChange,
  shapeKind,
  style,
}: StrokeControlsProps) {
  const strokeStyle = style.strokeStyle ?? 'solid';
  const dashGap = strokeDashGap(style);
  const dashKind = strokeStyle === 'dotted' ? 'dots' : 'dashes';
  return (
    <>
      <span className="panel-label">Stroke style</span>
      <div className="shape-style-row is-unlabeled">
        <div
          className="stroke-weight-options"
          role="group"
          aria-label="Stroke weight"
        >
          {[1, 2, 4].map((weight) => (
            <button
              type="button"
              className={
                style.strokeWidth === weight
                  ? 'shape-option is-active'
                  : 'shape-option'
              }
              aria-label={`Use ${weight} pixel stroke weight`}
              aria-pressed={style.strokeWidth === weight}
              key={weight}
              onClick={() => onStyleChange({ strokeWidth: weight })}
            >
              <span
                className="stroke-sample"
                style={{ borderTopWidth: weight }}
              />
            </button>
          ))}
        </div>
        <NumberInput
          className="shape-number-input"
          aria-label="Stroke weight value"
          minimum={MIN_STROKE_WIDTH}
          maximum={MAX_STROKE_WIDTH}
          step="1"
          value={style.strokeWidth}
          onValueChange={(strokeWidth) => onStyleChange({ strokeWidth })}
        />
      </div>
      <div className="shape-style-row is-unlabeled">
        <div
          className="stroke-pattern-options"
          role="group"
          aria-label="Stroke pattern"
        >
          {(['solid', 'dotted', 'dashed'] as const).map((pattern) => (
            <button
              type="button"
              className={
                strokeStyle === pattern
                  ? 'stroke-pattern-option is-active'
                  : 'stroke-pattern-option'
              }
              aria-label={`Use ${pattern} stroke`}
              aria-pressed={strokeStyle === pattern}
              title={pattern[0]?.toUpperCase() + pattern.slice(1)}
              key={pattern}
              onClick={() => onStyleChange({ strokeStyle: pattern })}
            >
              <span className={`stroke-pattern-sample is-${pattern}`} />
            </button>
          ))}
        </div>
      </div>
      {strokeStyle !== 'solid' && (
        <>
          <span className="panel-label">Gap between {dashKind}</span>
          <div className="stroke-gap-control">
            <input
              type="range"
              aria-label={`Gap between ${dashKind} slider`}
              min={MIN_STROKE_DASH_GAP}
              max={MAX_STROKE_DASH_GAP}
              step="1"
              value={dashGap}
              onChange={(event) =>
                onStrokeDashGapChange(Number(event.currentTarget.value))
              }
              onPointerDown={() => onStrokeDashGapGestureChange('start')}
              onPointerUp={() => onStrokeDashGapGestureChange('finish')}
              onPointerCancel={() => onStrokeDashGapGestureChange('finish')}
            />
            <NumberInput
              className="shape-number-input"
              aria-label={`Gap between ${dashKind} value`}
              minimum={MIN_STROKE_DASH_GAP}
              maximum={MAX_STROKE_DASH_GAP}
              step="1"
              value={dashGap}
              onValueChange={onStrokeDashGapChange}
            />
          </div>
        </>
      )}

      {((isShape && shapeKind !== 'ellipse') || isOrthogonalLine) && (
        <>
          <span className="panel-label">Corner radius</span>
          <div className="corner-radius-control">
            <input
              type="range"
              aria-label="Corner radius slider"
              min="0"
              max={MAX_CORNER_RADIUS}
              step="1"
              value={cornerRadius}
              onChange={(event) =>
                onCornerRadiusChange(Number(event.currentTarget.value))
              }
              onPointerDown={() => onCornerRadiusGestureChange('start')}
              onPointerUp={() => onCornerRadiusGestureChange('finish')}
              onPointerCancel={() => onCornerRadiusGestureChange('finish')}
            />
            <NumberInput
              className="shape-number-input"
              aria-label="Corner radius value"
              minimum={0}
              maximum={MAX_CORNER_RADIUS}
              step="1"
              value={cornerRadius}
              onValueChange={onCornerRadiusChange}
            />
          </div>
        </>
      )}

      {isLine && (
        <>
          <span className="panel-label">Arrowheads</span>
          <div
            className="line-end-options"
            role="group"
            aria-label="Path arrowheads"
          >
            {(
              [
                ['none', 'line', 'No arrows'],
                ['end', 'arrow', 'End arrow'],
                ['both', 'double-arrow', 'Double arrow'],
              ] as const
            ).map(([value, icon, label]) => (
              <button
                type="button"
                className={
                  arrowheads === value
                    ? 'shape-option is-active'
                    : 'shape-option'
                }
                aria-label={`Use ${label.toLowerCase()}`}
                aria-pressed={arrowheads === value}
                title={label}
                key={value}
                onClick={() => onArrowheadsChange(value)}
              >
                <Icon name={icon} />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
