/** Inspector controls for the next or selected shape kind and bounded corner radius. */
import type { ShapeKind } from '@chalkboard/shared';

import { Icon } from '../../components/Icon';
import { SHAPE_ICONS } from '../interaction/toolModel';

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
  onChange(kind: ShapeKind): void;
  shapeKind: ShapeKind;
}

export function ShapeControls({ onChange, shapeKind }: ShapeControlsProps) {
  return (
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
  );
}
