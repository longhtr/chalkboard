/** Inspector controls for shape kind and an ellipse's bounded arc range. */
import {
  isFullEllipseArc,
  MAX_ELLIPSE_ANGLE,
  MIN_ELLIPSE_ANGLE,
  normalizedEllipseArc,
  type ShapeKind,
} from '@chalkboard/shared';
import type { CSSProperties } from 'react';

import { Icon } from '../../components/Icon';
import { SHAPE_ICONS } from '../interaction/toolModel';
import { NumberInput } from './NumberInput';

const SHAPE_KINDS: { kind: ShapeKind; label: string }[] = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'ellipse', label: 'Circle / ellipse' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'trapezoid', label: 'Trapezoid' },
];

interface ShapeControlsProps {
  ellipseEndAngle: number;
  ellipseStartAngle: number;
  onChange(kind: ShapeKind): void;
  onEllipseAngleChange(change: {
    endAngle?: number;
    startAngle?: number;
  }): void;
  onEllipseAngleGestureChange(phase: 'finish' | 'start'): void;
  shapeKind: ShapeKind;
  showKindOptions: boolean;
}

export function ShapeControls({
  ellipseEndAngle,
  ellipseStartAngle,
  onChange,
  onEllipseAngleChange,
  onEllipseAngleGestureChange,
  shapeKind,
  showKindOptions,
}: ShapeControlsProps) {
  const range = normalizedEllipseArc(ellipseStartAngle, ellipseEndAngle);
  const rangeStyle = {
    '--arc-end': `${(range.endAngle / MAX_ELLIPSE_ANGLE) * 100}%`,
    '--arc-start': `${(range.startAngle / MAX_ELLIPSE_ANGLE) * 100}%`,
  } as CSSProperties;
  const rangeClassName = isFullEllipseArc(range)
    ? 'dual-range is-full'
    : range.endAngle < range.startAngle
      ? 'dual-range is-wrapped'
      : 'dual-range';
  const updateStartAngle = (candidate: number) => {
    let startAngle = candidate;
    if (startAngle === range.endAngle) {
      startAngle =
        range.startAngle < range.endAngle
          ? Math.min(MAX_ELLIPSE_ANGLE, startAngle + 1)
          : Math.max(MIN_ELLIPSE_ANGLE, startAngle - 1);
    }
    onEllipseAngleChange({ startAngle });
  };
  const updateEndAngle = (candidate: number) => {
    let endAngle = candidate;
    if (endAngle === range.startAngle) {
      endAngle =
        range.endAngle > range.startAngle
          ? Math.max(MIN_ELLIPSE_ANGLE, endAngle - 1)
          : Math.min(MAX_ELLIPSE_ANGLE, endAngle + 1);
    }
    onEllipseAngleChange({ endAngle });
  };
  const finishGesture = () => onEllipseAngleGestureChange('finish');

  return (
    <>
      {showKindOptions && (
        <>
          <span className="panel-label">Shape</span>
          <div className="shape-kind-options" role="group" aria-label="Shape">
            {SHAPE_KINDS.map(({ kind, label }) => (
              <button
                type="button"
                className={
                  shapeKind === kind ? 'shape-option is-active' : 'shape-option'
                }
                aria-label={`Use ${label.toLowerCase()} shape`}
                aria-pressed={shapeKind === kind}
                title={label}
                key={kind}
                onClick={() => onChange(kind)}
              >
                <Icon name={SHAPE_ICONS[kind]} />
              </button>
            ))}
          </div>
        </>
      )}
      {shapeKind === 'ellipse' && (
        <>
          <span className="panel-label">Arc range</span>
          <div
            className="ellipse-arc-control"
            role="group"
            aria-label="Ellipse arc range"
          >
            <div className={rangeClassName} style={rangeStyle}>
              <input
                className="dual-range__input is-start"
                type="range"
                aria-label="Arc start angle slider"
                min={MIN_ELLIPSE_ANGLE}
                max={MAX_ELLIPSE_ANGLE}
                step="1"
                value={range.startAngle}
                onChange={(event) =>
                  updateStartAngle(Number(event.currentTarget.value))
                }
                onPointerDown={() => onEllipseAngleGestureChange('start')}
                onPointerUp={finishGesture}
                onPointerCancel={finishGesture}
              />
              <input
                className="dual-range__input is-end"
                type="range"
                aria-label="Arc end angle slider"
                min={MIN_ELLIPSE_ANGLE}
                max={MAX_ELLIPSE_ANGLE}
                step="1"
                value={range.endAngle}
                onChange={(event) =>
                  updateEndAngle(Number(event.currentTarget.value))
                }
                onPointerDown={() => onEllipseAngleGestureChange('start')}
                onPointerUp={finishGesture}
                onPointerCancel={finishGesture}
              />
            </div>
            <div className="ellipse-angle-inputs">
              <label>
                <span>Start</span>
                <span className="degree-input">
                  <NumberInput
                    aria-label="Arc start angle"
                    minimum={MIN_ELLIPSE_ANGLE}
                    maximum={MAX_ELLIPSE_ANGLE}
                    step="1"
                    value={range.startAngle}
                    onValueChange={updateStartAngle}
                  />
                  <span aria-hidden="true">°</span>
                </span>
              </label>
              <label>
                <span>End</span>
                <span className="degree-input">
                  <NumberInput
                    aria-label="Arc end angle"
                    minimum={MIN_ELLIPSE_ANGLE}
                    maximum={MAX_ELLIPSE_ANGLE}
                    step="1"
                    value={range.endAngle}
                    onValueChange={updateEndAngle}
                  />
                  <span aria-hidden="true">°</span>
                </span>
              </label>
            </div>
          </div>
        </>
      )}
    </>
  );
}
