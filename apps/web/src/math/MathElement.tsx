/**
 * Inactive equation renderer. It retains last-valid markup through malformed
 * drafts, chooses bounded detail, observes dimensions, and never owns editor focus.
 */
import {
  worldToScreen,
  type Camera,
  type EquationElement,
} from '@chalkboard/shared';
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';

import { observeStaticMathResize } from './sharedResizeObserver';
import { mathSegments, parseMixedText, stripTextColors } from './mixedMath';
import { decorateStaticMathMarkup } from './staticMathDecoration';
import { staticMathMarkup } from './staticMathMarkup';

interface CachedMathRender {
  accessibleLabel: string;
  hasTextColors: boolean;
  markup: string;
  weight: number;
}

type ValidMathRender = Omit<CachedMathRender, 'weight'>;

const lastValidRenderByElement = new Map<string, CachedMathRender>();
const MAX_CACHED_MATH_RENDERS = 512;
const MAX_CACHED_MATH_RENDER_CODE_UNITS = 8_000_000;
const MAX_CACHED_MATH_RENDER_ENTRY_CODE_UNITS = 1_000_000;
let cachedMathRenderCodeUnits = 0;

function rememberValidRender(id: string, render: ValidMathRender) {
  const weight =
    id.length + render.accessibleLabel.length + render.markup.length;
  if (weight > MAX_CACHED_MATH_RENDER_ENTRY_CODE_UNITS) return;
  const previous = lastValidRenderByElement.get(id);
  if (previous !== undefined) cachedMathRenderCodeUnits -= previous.weight;
  lastValidRenderByElement.delete(id);
  lastValidRenderByElement.set(id, { ...render, weight });
  cachedMathRenderCodeUnits += weight;
  while (
    lastValidRenderByElement.size > MAX_CACHED_MATH_RENDERS ||
    cachedMathRenderCodeUnits > MAX_CACHED_MATH_RENDER_CODE_UNITS
  ) {
    const oldestId = lastValidRenderByElement.keys().next().value;
    if (oldestId === undefined) break;
    const oldest = lastValidRenderByElement.get(oldestId);
    lastValidRenderByElement.delete(oldestId);
    cachedMathRenderCodeUnits -= oldest?.weight ?? 0;
  }
}

interface MathElementProps {
  camera: Camera;
  element: EquationElement;
  isEditing?: boolean;
  layer?: number;
  simplified?: boolean;
  onMeasure(id: string, width: number, height: number): void;
}

function MathElementComponent({
  camera,
  element,
  isEditing = false,
  layer,
  simplified = false,
  onMeasure,
}: MathElementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedElement = element;
  const position = worldToScreen(renderedElement, camera);
  const math = useMemo(
    () => mathSegments(renderedElement.source),
    [renderedElement.source],
  );
  const isMathOnly = useMemo(
    () =>
      math.length === 1 &&
      parseMixedText(renderedElement.source).every(
        (segment) => segment.kind === 'math' || segment.source.trim() === '',
      ),
    [renderedElement.source, math.length],
  );
  const mathLabel = isMathOnly ? math[0]?.latex : undefined;
  const accessibleLabel = stripTextColors(mathLabel ?? renderedElement.source);
  const hasTextColors = renderedElement.source.includes('\\textcolor{');
  const candidateMarkup = useMemo(() => {
    if (simplified) return null;
    try {
      return staticMathMarkup(renderedElement.source, {
        baseColor: renderedElement.strokeColor,
        isMathOnly,
        lineSpacing: renderedElement.lineSpacing,
      });
    } catch {
      return null;
    }
  }, [
    isMathOnly,
    renderedElement.lineSpacing,
    renderedElement.source,
    renderedElement.strokeColor,
    simplified,
  ]);
  if (candidateMarkup !== null) {
    rememberValidRender(renderedElement.id, {
      accessibleLabel,
      hasTextColors,
      markup: candidateMarkup,
    });
  }
  const lastValidRender = lastValidRenderByElement.get(renderedElement.id);
  const markup = simplified
    ? null
    : (candidateMarkup ?? lastValidRender?.markup ?? null);
  const renderedAccessibleLabel = simplified
    ? accessibleLabel
    : candidateMarkup === null
      ? (lastValidRender?.accessibleLabel ?? accessibleLabel)
      : accessibleLabel;
  const renderedHasTextColors =
    candidateMarkup === null
      ? (lastValidRender?.hasTextColors ?? hasTextColors)
      : hasTextColors;

  // React reapplies dangerouslySetInnerHTML when a parent state change (such as
  // selection) rerenders this component. Restore special text and color
  // decoration after every render, before paint.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container !== null && markup !== null) {
      decorateStaticMathMarkup(container, {
        baseColor: renderedElement.strokeColor,
        hasTextColors: renderedHasTextColors,
      });
    }
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (isEditing || container === null || markup === null) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const bounds = container.getBoundingClientRect();
      const width = bounds.width / camera.zoom;
      const height = bounds.height / camera.zoom;
      if (
        Math.abs(width - renderedElement.width) > 1 ||
        Math.abs(height - renderedElement.height) > 1
      ) {
        onMeasure(renderedElement.id, width, height);
      }
    };

    measure();
    const stopObserving = observeStaticMathResize(container, measure);
    return () => {
      disposed = true;
      stopObserving();
    };
  }, [
    camera.zoom,
    isEditing,
    markup,
    onMeasure,
    renderedElement.height,
    renderedElement.id,
    renderedElement.lineSpacing,
    renderedElement.strokeColor,
    renderedElement.width,
  ]);

  return (
    <div
      aria-label={renderedAccessibleLabel}
      className={`math-element${simplified ? ' is-simplified' : ''}`}
      data-mixed-text-id={renderedElement.id}
      data-render-detail={simplified ? 'simplified' : 'full'}
      ref={containerRef}
      role={isMathOnly ? 'math' : 'group'}
      style={
        {
          '--element-color': renderedElement.strokeColor,
          '--mixed-line-spacing': `${renderedElement.lineSpacing ?? 1.2}em`,
          fontSize: renderedElement.fontSize,
          lineHeight: renderedElement.lineSpacing ?? 1.2,
          left: position.x,
          opacity: isEditing ? 0 : undefined,
          top: position.y,
          transform: `scale(${camera.zoom})`,
          zIndex: layer,
          width: simplified ? renderedElement.width : undefined,
        } as CSSProperties
      }
    >
      {markup === null ? (
        stripTextColors(renderedElement.source)
      ) : (
        <div
          className={
            isMathOnly ? 'math-element__content' : 'mixed-text-element__content'
          }
          dangerouslySetInnerHTML={{ __html: markup }}
          style={{ color: renderedElement.strokeColor }}
        />
      )}
    </div>
  );
}

function mathElementPropsEqual(
  previous: Readonly<MathElementProps>,
  next: Readonly<MathElementProps>,
) {
  return (
    previous.camera === next.camera &&
    previous.element === next.element &&
    previous.isEditing === next.isEditing &&
    previous.layer === next.layer &&
    previous.onMeasure === next.onMeasure &&
    previous.simplified === next.simplified
  );
}

/** Memoized inactive equation renderer with shared measurement observation. */
export const MathElement = memo(MathElementComponent, mathElementPropsEqual);
MathElement.displayName = 'MathElement';
