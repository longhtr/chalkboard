/** Inspector controls for path kind, arrowheads, Bézier accuracy/segments, and spline continuity. */
import type { SplineContinuity } from '@chalkboard/shared';

import { Icon } from '../../components/Icon';
import type { BezierFitSettings } from '../interaction/drawingInteraction';
import { PATH_ICONS, type PathToolKind } from '../interaction/toolModel';
import { NumberInput } from './NumberInput';

const PATH_KINDS: { kind: PathToolKind; label: string }[] = [
  { kind: 'straight', label: 'Straight' },
  { kind: 'bezier', label: 'Spline' },
  { kind: 'orthogonal', label: 'Orthogonal' },
  { kind: 'freehand', label: 'Freehand' },
];

const CONTINUITY_OPTIONS: {
  label: string;
  title: string;
  value: SplineContinuity;
}[] = [
  {
    label: 'C⁰',
    title: 'C⁰ — Joined segments; corners are permitted.',
    value: 'c0',
  },
  {
    label: 'C¹',
    title: 'C¹ — Matching tangent and parameter speed.',
    value: 'c1',
  },
  {
    label: 'C²',
    title:
      'C² — Matching tangent and curvature. On closed loops, control handles follow the editable nodes.',
    value: 'c2',
  },
];

interface PathControlsProps {
  allowFreehand: boolean;
  fit: BezierFitSettings;
  manualMaximum: number;
  onAccuracyChange(accuracy: number): void;
  onContinuityChange(continuity: SplineContinuity): void;
  onManualMaximumChange(maximum: number): void;
  onPathChange(kind: PathToolKind): void;
  onToggleAutomaticMaximum(): void;
  pathKind: PathToolKind;
  showFittingControls: boolean;
}

export function PathControls({
  allowFreehand,
  fit,
  manualMaximum,
  onAccuracyChange,
  onContinuityChange,
  onManualMaximumChange,
  onPathChange,
  onToggleAutomaticMaximum,
  pathKind,
  showFittingControls,
}: PathControlsProps) {
  return (
    <>
      <span className="panel-label">Path type</span>
      <div className="path-kind-options" role="group" aria-label="Path type">
        {PATH_KINDS.filter(
          ({ kind }) => kind !== 'freehand' || allowFreehand,
        ).map(({ kind, label }) => (
          <button
            type="button"
            className={
              pathKind === kind ? 'shape-option is-active' : 'shape-option'
            }
            aria-label={
              kind === 'bezier'
                ? 'Use spline path'
                : kind === 'freehand'
                  ? 'Use freehand path'
                  : `Use ${label.toLowerCase()} path`
            }
            aria-pressed={pathKind === kind}
            title={
              kind === 'bezier'
                ? 'Spline — Draw freely. On release, your stroke is fitted with smooth curves. Refine it with its handles.'
                : kind === 'orthogonal'
                  ? 'Orthogonal — Draw freely. On release, your stroke is fitted with connected horizontal and vertical lines.'
                  : kind === 'freehand'
                    ? 'Freehand — Keep the natural path you draw.'
                    : label
            }
            key={kind}
            onClick={() => onPathChange(kind)}
          >
            <Icon name={PATH_ICONS[kind]} />
          </button>
        ))}
      </div>
      {pathKind === 'straight' && (
        <p className="path-keyboard-hint" role="note">
          While drawing, press <kbd>Space</kbd> or tap with a second finger to
          add another segment. Hold the second finger to constrain the angle.
        </p>
      )}
      {pathKind === 'bezier' && (
        <>
          <span className="panel-label">Continuity</span>
          <div
            className="input-mode-options"
            role="group"
            aria-label="Spline continuity"
          >
            {CONTINUITY_OPTIONS.map(({ label, title, value }) => (
              <button
                type="button"
                className={
                  fit.continuity === value
                    ? 'input-mode-option is-active'
                    : 'input-mode-option'
                }
                aria-label={`Use ${value.toUpperCase()} spline continuity`}
                aria-pressed={fit.continuity === value}
                key={value}
                onClick={() => onContinuityChange(value)}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {showFittingControls && pathKind === 'bezier' && (
        <>
          <span className="panel-label">Maximum curves</span>
          <div
            className="bezier-maximum-control"
            role="group"
            aria-label="Maximum curves"
          >
            <input
              type="range"
              aria-label="Maximum curves slider"
              min="1"
              max="12"
              step="1"
              disabled={fit.maxSegments === null}
              value={manualMaximum}
              onChange={(event) =>
                onManualMaximumChange(Number(event.currentTarget.value))
              }
            />
            <NumberInput
              className="shape-number-input"
              aria-label="Maximum curves value"
              minimum={1}
              maximum={12}
              step="1"
              disabled={fit.maxSegments === null}
              value={manualMaximum}
              onValueChange={(value) =>
                onManualMaximumChange(Math.round(value))
              }
            />
            <button
              type="button"
              className="bezier-auto-button"
              aria-label="Automatically choose curve count"
              aria-pressed={fit.maxSegments === null}
              onClick={onToggleAutomaticMaximum}
              title="Recommended — chooses the simplest stable curve count that preserves the gesture."
            >
              Auto
            </button>
          </div>
          {fit.maxSegments === null && (
            <>
              <span
                className="panel-label"
                title="How much deliberate detail the fitted curves preserve. Each step permits about 33% less geometric error and may use more curves."
              >
                Accuracy
              </span>
              <div className="bezier-accuracy-control">
                <input
                  type="range"
                  aria-label="Automatic fitting accuracy slider"
                  min="1"
                  max="5"
                  step="1"
                  value={fit.accuracy}
                  onChange={(event) =>
                    onAccuracyChange(Number(event.currentTarget.value))
                  }
                />
                <NumberInput
                  className="shape-number-input"
                  aria-label="Automatic fitting accuracy value"
                  minimum={1}
                  maximum={5}
                  step="1"
                  value={fit.accuracy}
                  onValueChange={(value) => onAccuracyChange(Math.round(value))}
                />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
