/** Primary tool chooser plus keyboard hints and persisted drag-to-reorder mode. */
import type { ShapeKind } from '@chalkboard/shared';
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';

import { Icon } from '../../components/Icon';
import {
  DEFAULT_TOOL_ORDER,
  PATH_ICONS,
  SHAPE_ICONS,
  TOOL_DETAILS,
  type PathToolKind,
  type Tool,
} from '../interaction/toolModel';

const TOOL_REORDER_DRAG_THRESHOLD_PX = 4;

interface ToolReorderInteraction {
  pointerId: number;
  source: Tool;
  startX: number;
  startY: number;
  started: boolean;
  target: Tool;
}

interface ToolDockProps {
  activeTool: Tool;
  canDelete: boolean;
  displayedPathKind: PathToolKind;
  displayedShapeKind: ShapeKind;
  editingEquation: boolean;
  inputMode: 'math' | 'text';
  sourceView: boolean;
  onDelete(): void;
  onImport(): void;
  onSelectTool(tool: Tool): void;
  onToggleActiveEquationMode(): void;
  onToggleInputMode(): void;
  onToggleSelectionObjects(): void;
  onToolOrderChange(order: Tool[]): void;
  readOnly?: boolean;
  selectionObjectsOpen: boolean;
  toolOrder: Tool[];
}

export function ToolDock({
  activeTool,
  canDelete,
  displayedPathKind,
  displayedShapeKind,
  editingEquation,
  inputMode,
  sourceView,
  onDelete,
  onImport,
  onSelectTool,
  onToggleActiveEquationMode,
  onToggleInputMode,
  onToggleSelectionObjects,
  onToolOrderChange,
  readOnly = false,
  selectionObjectsOpen,
  toolOrder,
}: ToolDockProps) {
  const dockRef = useRef<HTMLDivElement>(null);
  const reorderRef = useRef<ToolReorderInteraction | null>(null);
  const activeToolRef = useRef(activeTool);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(
    () => () => {
      if (suppressTimerRef.current !== null)
        window.clearTimeout(suppressTimerRef.current);
    },
    [],
  );

  function clearDragClasses(): void {
    dockRef.current
      ?.querySelectorAll('.is-dragging, .is-drop-target')
      .forEach((button) =>
        button.classList.remove('is-dragging', 'is-drop-target'),
      );
  }

  const supportedToolOrder = [
    ...toolOrder.filter(
      (tool, index) =>
        DEFAULT_TOOL_ORDER.includes(tool) && toolOrder.indexOf(tool) === index,
    ),
    ...DEFAULT_TOOL_ORDER.filter((tool) => !toolOrder.includes(tool)),
  ];
  const visibleToolOrder = readOnly
    ? supportedToolOrder.filter(
        (tool) => tool === 'selection' || tool === 'hand',
      )
    : supportedToolOrder;

  return (
    <div
      className="tool-dock"
      ref={dockRef}
      role="toolbar"
      aria-label="Drawing tools"
    >
      {visibleToolOrder.map((tool) => {
        const index = supportedToolOrder.indexOf(tool);
        const { icon, label } = TOOL_DETAILS[tool];
        const equationModeLabel =
          tool === 'equation'
            ? sourceView
              ? ' — source mode'
              : ` — ${inputMode} mode`
            : '';
        const title = readOnly
          ? label
          : `${label} — Ctrl+${index + 1} — drag to reorder${equationModeLabel}`;
        return (
          <Fragment key={tool}>
            <button
              className={
                activeTool === tool ? 'tool-button is-active' : 'tool-button'
              }
              type="button"
              aria-label={`${label} tool`}
              aria-pressed={activeTool === tool}
              data-keep-math-editor-open={
                tool === 'equation' ? true : undefined
              }
              data-shape-kind={
                tool === 'shape' ? displayedShapeKind : undefined
              }
              data-path-kind={tool === 'line' ? displayedPathKind : undefined}
              data-toolbar-tool={tool}
              title={title}
              onClick={() => {
                if (suppressClickRef.current) return;
                if (
                  tool !== 'equation' ||
                  activeToolRef.current !== 'equation'
                ) {
                  activeToolRef.current = tool;
                  onSelectTool(tool);
                } else if (editingEquation) {
                  onToggleActiveEquationMode();
                } else {
                  onToggleInputMode();
                }
              }}
              onPointerDown={(event) => {
                if (readOnly || event.button !== 0) return;
                reorderRef.current = {
                  pointerId: event.pointerId,
                  source: tool,
                  startX: event.clientX,
                  startY: event.clientY,
                  started: false,
                  target: tool,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                if (tool === 'equation' && editingEquation) {
                  event.preventDefault();
                }
              }}
              onPointerMove={(event) => {
                if (readOnly) return;
                const interaction = reorderRef.current;
                if (
                  interaction === null ||
                  interaction.pointerId !== event.pointerId
                ) {
                  return;
                }
                if (
                  !interaction.started &&
                  Math.hypot(
                    event.clientX - interaction.startX,
                    event.clientY - interaction.startY,
                  ) < TOOL_REORDER_DRAG_THRESHOLD_PX
                ) {
                  return;
                }
                interaction.started = true;
                event.preventDefault();
                event.currentTarget.classList.add('is-dragging');
                dockRef.current
                  ?.querySelector('.is-drop-target')
                  ?.classList.remove('is-drop-target');
                const targetButton = document
                  .elementFromPoint(event.clientX, event.clientY)
                  ?.closest<HTMLElement>('[data-toolbar-tool]');
                const target = targetButton?.dataset.toolbarTool as
                  Tool | undefined;
                if (
                  targetButton !== null &&
                  targetButton !== undefined &&
                  target !== undefined &&
                  DEFAULT_TOOL_ORDER.includes(target)
                ) {
                  interaction.target = target;
                  if (target !== interaction.source) {
                    targetButton.classList.add('is-drop-target');
                  }
                }
              }}
              onPointerUp={(event) => {
                if (readOnly) return;
                const interaction = reorderRef.current;
                if (
                  interaction === null ||
                  interaction.pointerId !== event.pointerId
                ) {
                  return;
                }
                if (
                  interaction.started &&
                  interaction.source !== interaction.target
                ) {
                  const sourceIndex = supportedToolOrder.indexOf(
                    interaction.source,
                  );
                  const targetIndex = supportedToolOrder.indexOf(
                    interaction.target,
                  );
                  if (sourceIndex >= 0 && targetIndex >= 0) {
                    const reordered = [...supportedToolOrder];
                    const [movedTool] = reordered.splice(sourceIndex, 1);
                    if (movedTool !== undefined) {
                      reordered.splice(targetIndex, 0, movedTool);
                      onToolOrderChange(reordered);
                    }
                  }
                }
                if (interaction.started) {
                  suppressClickRef.current = true;
                  suppressTimerRef.current = window.setTimeout(() => {
                    suppressClickRef.current = false;
                    suppressTimerRef.current = null;
                  });
                }
                reorderRef.current = null;
                clearDragClasses();
              }}
              onPointerCancel={() => {
                if (readOnly) return;
                reorderRef.current = null;
                clearDragClasses();
              }}
            >
              <span className="tool-glyph">
                {tool === 'equation' ? (
                  <span className="mixed-text-tool-mode" aria-live="polite">
                    {sourceView ? 'S' : inputMode === 'math' ? 'M' : 'T'}
                  </span>
                ) : (
                  <Icon
                    name={
                      tool === 'shape'
                        ? SHAPE_ICONS[displayedShapeKind]
                        : tool === 'line'
                          ? PATH_ICONS[displayedPathKind]
                          : icon
                    }
                  />
                )}
              </span>
              <kbd className="tool-shortcut">{index + 1}</kbd>
            </button>
            {tool === 'selection' && activeTool === 'selection' ? (
              <button
                className={
                  selectionObjectsOpen
                    ? 'tool-button tool-panel-button is-active'
                    : 'tool-button tool-panel-button'
                }
                type="button"
                aria-label="Board objects"
                aria-expanded={selectionObjectsOpen}
                title="Board objects"
                onClick={onToggleSelectionObjects}
              >
                <Icon name="menu" size={15} />
              </button>
            ) : null}
          </Fragment>
        );
      })}
      {!readOnly ? (
        <>
          <span className="tool-divider" />
          <button
            className="tool-button"
            type="button"
            aria-label="Import image / SVG"
            title="Import image / SVG"
            onClick={onImport}
          >
            <Icon name="image" />
          </button>
          <button
            className="tool-button"
            type="button"
            aria-label="Delete selection"
            disabled={!canDelete}
            title="Delete selection"
            onClick={onDelete}
          >
            <Icon name="trash" />
          </button>
        </>
      ) : null}
    </div>
  );
}
