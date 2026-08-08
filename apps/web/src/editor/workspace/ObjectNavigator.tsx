/**
 * Accessible nonvisual discovery and manipulation surface for board objects.
 * Results are paged and searchable, with semantic labels and bounded position
 * edits.
 */
import type { BoardElement } from '@chalkboard/shared';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';

import type { SelectionOrderCommand } from '../interaction/selectionInteraction';
import { keyboardEventEditsText } from '../interaction/keyboardCommands';

function elementName(element: BoardElement): string {
  switch (element.type) {
    case 'shape':
      return `${element.shapeKind[0]?.toUpperCase() ?? ''}${element.shapeKind.slice(1)} shape`;
    case 'rectangle':
      return 'Rectangle shape';
    case 'line':
      return element.pathKind === 'bezier'
        ? 'Spline line'
        : `${element.pathKind[0]?.toUpperCase() ?? ''}${element.pathKind.slice(1)} line`;
    case 'arrow':
      return 'Arrow';
    case 'freehand':
      return 'Freehand stroke';
    case 'equation':
      return 'Mixed text block';
    case 'image':
      return `Image: ${element.name}`;
  }
}

function elementSummary(element: BoardElement): string | null {
  if (element.type === 'equation') {
    const source = element.source.replaceAll(/\s+/g, ' ').trim();
    if (source === '') return 'Empty';
    return source.length > 80 ? `${source.slice(0, 77)}…` : source;
  }
  if (element.type === 'image') return element.name;
  return null;
}

function elementSearchText(element: BoardElement): string {
  const content =
    element.type === 'equation'
      ? element.source
      : element.type === 'image'
        ? element.name
        : '';
  return `${elementName(element)} ${content}`.toLocaleLowerCase();
}

interface ObjectNavigatorProps {
  elements: BoardElement[];
  focusOnOpen?: boolean;
  onClose(): void;
  onDeleteSelected(): void;
  onDropAtEdge(selectedIds: ReadonlySet<string>, edge: 'bottom' | 'top'): void;
  onDropSelected(
    selectedIds: ReadonlySet<string>,
    targetId: string,
    placement: 'after' | 'before',
  ): void;
  onCenterObject(id: string): void;
  onMoveSelected(command: SelectionOrderCommand): void;
  onSelect(id: string, mode: 'toggle' | 'replace'): void;
  onSelectRange(ids: string[]): void;
  readOnly: boolean;
  selectedIds: ReadonlySet<string>;
}

type DropTarget =
  | { edge: 'bottom' | 'top'; kind: 'edge' }
  | { id: string; kind: 'object'; placement: 'after' | 'before' };

interface HoverHint {
  id: string;
  top: number;
}

type ObjectSortMode = 'layer' | 'vertical';

const HOVER_HINT_DELAY_MS = 1_000;
const HOVER_HINT_GAP_PX = 5;
const HOVER_HINT_HEIGHT_PX = 48;
const VIRTUALIZATION_THRESHOLD = 200;
const VIRTUAL_ROW_HEIGHT = 70;
const VIRTUAL_ROW_STRIDE = 76;
const VIRTUAL_EDGE_OFFSET = 14;
const VIRTUAL_OVERSCAN = 8;

/**
 * Exposes board order and selection without relying on visual hit testing. Large
 * boards virtualize fixed-height rows while preserving semantic list position.
 */
export function ObjectNavigator({
  elements,
  focusOnOpen = true,
  onCenterObject,
  onClose,
  onDeleteSelected,
  onDropAtEdge,
  onDropSelected,
  onMoveSelected,
  onSelect,
  onSelectRange,
  readOnly,
  selectedIds,
}: ObjectNavigatorProps) {
  const navigatorRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string> | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);
  const [sortMode, setSortMode] = useState<ObjectSortMode>('layer');
  const [searchQuery, setSearchQuery] = useState('');
  const [virtualRange, setVirtualRange] = useState({ end: 0, start: 0 });
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const sortedElements = useMemo(
    () =>
      sortMode === 'layer'
        ? [...elements].reverse()
        : [...elements].sort(
            (first, second) =>
              first.y - second.y ||
              first.x - second.x ||
              first.id.localeCompare(second.id),
          ),
    [elements, sortMode],
  );
  const sortedIndexById = useMemo(
    () => new Map(sortedElements.map((element, index) => [element.id, index])),
    [sortedElements],
  );
  const searchTextById = useMemo(
    () =>
      new Map(
        elements.map((element) => [element.id, elementSearchText(element)]),
      ),
    [elements],
  );
  const searchTerms = useMemo(
    () =>
      deferredSearchQuery
        .toLocaleLowerCase()
        .trim()
        .split(/\s+/u)
        .filter(Boolean),
    [deferredSearchQuery],
  );
  const orderedElements = useMemo(
    () =>
      searchTerms.length === 0
        ? sortedElements
        : sortedElements.filter((element) => {
            const text = searchTextById.get(element.id) ?? '';
            return searchTerms.every((term) => text.includes(term));
          }),
    [searchTerms, searchTextById, sortedElements],
  );
  const virtualized = orderedElements.length > VIRTUALIZATION_THRESHOLD;
  const updateVirtualRange = useCallback(() => {
    if (!virtualized) return;
    const list = listRef.current;
    if (list === null) return;
    const firstVisible = Math.floor(
      Math.max(0, list.scrollTop - VIRTUAL_EDGE_OFFSET) / VIRTUAL_ROW_STRIDE,
    );
    const visibleCount = Math.ceil(list.clientHeight / VIRTUAL_ROW_STRIDE);
    setVirtualRange({
      start: Math.max(0, firstVisible - VIRTUAL_OVERSCAN),
      end: Math.min(
        orderedElements.length,
        firstVisible + visibleCount + VIRTUAL_OVERSCAN,
      ),
    });
  }, [orderedElements.length, virtualized]);
  const renderedStart = virtualized ? virtualRange.start : 0;
  const renderedElements = virtualized
    ? orderedElements.slice(renderedStart, virtualRange.end)
    : orderedElements;
  const hasUnselectedElementAt = (index: number): boolean => {
    const candidate = elements[index];
    return candidate !== undefined && !selectedIds.has(candidate.id);
  };
  const canMoveForward = elements.some(
    (element, index) =>
      selectedIds.has(element.id) && hasUnselectedElementAt(index + 1),
  );
  const canMoveBackward = elements.some(
    (element, index) =>
      selectedIds.has(element.id) && hasUnselectedElementAt(index - 1),
  );
  const firstSelectedIndex = orderedElements.findIndex((element) =>
    selectedIds.has(element.id),
  );
  const lastSelectedIndex = orderedElements.findLastIndex((element) =>
    selectedIds.has(element.id),
  );
  const idsBetweenSelection =
    firstSelectedIndex >= 0 && lastSelectedIndex > firstSelectedIndex
      ? orderedElements
          .slice(firstSelectedIndex, lastSelectedIndex + 1)
          .map((element) => element.id)
      : [];
  const canSelectBetween = idsBetweenSelection.some(
    (id) => !selectedIds.has(id),
  );

  useEffect(() => {
    if (focusOnOpen) (searchRef.current ?? closeRef.current)?.focus();
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, [focusOnOpen]);

  useEffect(() => {
    const list = listRef.current;
    if (!virtualized || list === null) return;
    list.scrollTop = 0;
    updateVirtualRange();
    const observer = new ResizeObserver(updateVirtualRange);
    observer.observe(list);
    return () => observer.disconnect();
  }, [deferredSearchQuery, sortMode, updateVirtualRange, virtualized]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (
        !readOnly &&
        selectedIds.size > 0 &&
        !keyboardEventEditsText(event) &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDeleteSelected();
      }
    };
    window.addEventListener('keydown', handleKeyboard, true);
    return () => window.removeEventListener('keydown', handleKeyboard, true);
  }, [onClose, onDeleteSelected, readOnly, selectedIds]);

  useEffect(() => {
    const selectedId = [...selectedIds].at(-1);
    const navigator = navigatorRef.current;
    const list = listRef.current;
    if (selectedId === undefined || navigator === null || list === null) return;
    const index = orderedElements.findIndex(({ id }) => id === selectedId);
    if (index < 0) return;
    if (virtualized) {
      const top = VIRTUAL_EDGE_OFFSET + index * VIRTUAL_ROW_STRIDE;
      const bottom = top + VIRTUAL_ROW_HEIGHT;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
      updateVirtualRange();
    }
    const revealSelectedEntry = () => {
      const selectedEntry = [
        ...navigator.querySelectorAll<HTMLElement>('[data-object-id]'),
      ].find((entry) => entry.dataset.objectId === selectedId);
      selectedEntry?.scrollIntoView?.({ block: 'nearest' });
    };
    if (virtualized) window.requestAnimationFrame(revealSelectedEntry);
    else revealSelectedEntry();
  }, [orderedElements, selectedIds, sortMode, updateVirtualRange, virtualized]);

  const hideHoverHint = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverHint(null);
  };

  const scheduleHoverHint = (entry: HTMLLIElement, id: string) => {
    hideHoverHint();
    if (sortMode !== 'layer') return;
    hoverTimerRef.current = window.setTimeout(() => {
      const navigator = navigatorRef.current;
      if (navigator === null || !entry.isConnected) return;
      const entryBounds = entry.getBoundingClientRect();
      const navigatorBounds = navigator.getBoundingClientRect();
      const below =
        entryBounds.bottom - navigatorBounds.top + HOVER_HINT_GAP_PX;
      const top =
        below + HOVER_HINT_HEIGHT_PX <= navigatorBounds.height
          ? below
          : Math.max(
              HOVER_HINT_GAP_PX,
              entryBounds.top -
                navigatorBounds.top -
                HOVER_HINT_HEIGHT_PX -
                HOVER_HINT_GAP_PX,
            );
      setHoverHint({ id, top });
      hoverTimerRef.current = null;
    }, HOVER_HINT_DELAY_MS);
  };

  const beginDrag = (event: DragEvent<HTMLLIElement>, id: string) => {
    if (readOnly || sortMode !== 'layer') {
      event.preventDefault();
      return;
    }
    hideHoverHint();
    const ids = selectedIds.has(id) ? new Set(selectedIds) : new Set([id]);
    if (!selectedIds.has(id)) onSelect(id, 'replace');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    setDraggingIds(ids);
    setDropTarget(null);
  };

  const updateDropTarget = (
    event: DragEvent<HTMLLIElement>,
    targetId: string,
  ) => {
    if (draggingIds === null || draggingIds.has(targetId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement =
      event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
    setDropTarget({ id: targetId, kind: 'object', placement });
  };

  const updateEdgeDropTarget = (
    event: DragEvent<HTMLLIElement>,
    edge: 'bottom' | 'top',
  ) => {
    if (draggingIds === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ edge, kind: 'edge' });
  };

  const finishDrag = () => {
    setDraggingIds(null);
    setDropTarget(null);
  };

  return (
    <aside
      ref={navigatorRef}
      className="object-navigator"
      aria-labelledby="object-navigator-title"
    >
      <header className="object-navigator__header">
        <div>
          <h2 id="object-navigator-title">Board objects</h2>
          <p>{elements.length} objects</p>
        </div>
        <button
          ref={closeRef}
          className="object-navigator__close"
          type="button"
          aria-label="Close board objects"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {elements.length === 0 ? null : (
        <div className="object-navigator__search">
          <label htmlFor="object-navigator-search">Search objects</label>
          <input
            ref={searchRef}
            id="object-navigator-search"
            type="search"
            autoComplete="off"
            placeholder="Type or content"
            value={searchQuery}
            onChange={(event) => {
              hideHoverHint();
              finishDrag();
              setSearchQuery(event.currentTarget.value);
            }}
          />
          <p role="status" aria-live="polite">
            {searchTerms.length === 0 ? (
              <span aria-hidden="true">&nbsp;</span>
            ) : (
              `${orderedElements.length} of ${elements.length} objects shown`
            )}
          </p>
        </div>
      )}
      <div
        className="object-navigator__sort"
        role="group"
        aria-label="Sort board objects"
      >
        <button
          type="button"
          aria-label="Sort by layer"
          aria-pressed={sortMode === 'layer'}
          onClick={() => setSortMode('layer')}
        >
          Layer
        </button>
        <button
          type="button"
          aria-label="Sort by vertical position"
          aria-pressed={sortMode === 'vertical'}
          onClick={() => {
            finishDrag();
            hideHoverHint();
            setSortMode('vertical');
          }}
        >
          Vertical position
        </button>
      </div>
      {elements.length === 0 ? (
        <p className="object-navigator__empty" role="status">
          This board has no objects yet.
        </p>
      ) : orderedElements.length === 0 ? (
        <p className="object-navigator__empty">
          No objects match “{deferredSearchQuery.trim()}”.
        </p>
      ) : (
        <ol
          ref={listRef}
          className={[
            'object-navigator__list',
            sortMode === 'vertical' ? 'is-position-sorted' : '',
            virtualized ? 'is-virtualized' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-describedby="object-navigator-order-hint"
          onScroll={virtualized ? updateVirtualRange : undefined}
        >
          {virtualized ? (
            <li
              aria-hidden="true"
              className="object-navigator__virtual-spacer"
              style={{
                height:
                  orderedElements.length * VIRTUAL_ROW_STRIDE +
                  VIRTUAL_EDGE_OFFSET * 2,
              }}
            />
          ) : null}
          {sortMode === 'layer' ? (
            <li
              aria-hidden="true"
              className={
                dropTarget?.kind === 'edge' && dropTarget.edge === 'top'
                  ? 'object-navigator__drop-edge is-active'
                  : 'object-navigator__drop-edge'
              }
              style={virtualized ? { top: 0 } : undefined}
              onDragLeave={() =>
                setDropTarget((current) =>
                  current?.kind === 'edge' && current.edge === 'top'
                    ? null
                    : current,
                )
              }
              onDragOver={(event) => updateEdgeDropTarget(event, 'top')}
              onDrop={(event) => {
                if (draggingIds === null) return;
                event.preventDefault();
                event.stopPropagation();
                onDropAtEdge(draggingIds, 'top');
                finishDrag();
              }}
            />
          ) : null}
          {renderedElements.map((element, renderedIndex) => {
            const index = renderedStart + renderedIndex;
            const objectIndex = (sortedIndexById.get(element.id) ?? index) + 1;
            const name = elementName(element);
            const summary = elementSummary(element);
            const selected = selectedIds.has(element.id);
            const position = `${Math.round(element.x)}, ${Math.round(element.y)}`;
            const dropPlacement =
              dropTarget?.kind === 'object' && dropTarget.id === element.id
                ? dropTarget.placement
                : null;
            const className = [
              draggingIds?.has(element.id) === true ? 'is-dragging' : '',
              dropPlacement === 'before' ? 'is-drop-before' : '',
              dropPlacement === 'after' ? 'is-drop-after' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <li
                className={className || undefined}
                draggable={sortMode === 'layer' && !readOnly}
                key={element.id}
                aria-posinset={virtualized ? index + 1 : undefined}
                aria-setsize={virtualized ? orderedElements.length : undefined}
                style={
                  virtualized
                    ? {
                        height: VIRTUAL_ROW_HEIGHT,
                        top: VIRTUAL_EDGE_OFFSET + index * VIRTUAL_ROW_STRIDE,
                      }
                    : undefined
                }
                onDragEnd={finishDrag}
                onDragLeave={(event) => {
                  const relatedTarget = event.relatedTarget;
                  if (
                    !(relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(relatedTarget)
                  ) {
                    setDropTarget((current) =>
                      current?.kind === 'object' && current.id === element.id
                        ? null
                        : current,
                    );
                  }
                }}
                onDragOver={(event) => updateDropTarget(event, element.id)}
                onDragStart={(event) => beginDrag(event, element.id)}
                onDrop={(event) => {
                  if (
                    draggingIds === null ||
                    draggingIds.has(element.id) ||
                    dropPlacement === null
                  ) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  onDropSelected(draggingIds, element.id, dropPlacement);
                  finishDrag();
                }}
                onMouseEnter={(event) =>
                  scheduleHoverHint(event.currentTarget, element.id)
                }
                onMouseLeave={hideHoverHint}
              >
                <button
                  type="button"
                  aria-label={`${name}, object ${objectIndex}, position ${position}`}
                  aria-pressed={selected}
                  data-object-id={element.id}
                  onClick={(event) => {
                    onSelect(element.id, event.shiftKey ? 'toggle' : 'replace');
                    onCenterObject(element.id);
                  }}
                >
                  {sortMode === 'layer' ? (
                    <span
                      className="object-navigator__drag-handle"
                      aria-hidden="true"
                    >
                      ⋮⋮
                    </span>
                  ) : null}
                  <span className="object-navigator__index" aria-hidden="true">
                    {objectIndex}
                  </span>
                  <span className="object-navigator__details">
                    <strong>{name}</strong>
                    {summary === null ? null : <span>{summary}</span>}
                    <small>Position {position}</small>
                  </span>
                  {selected ? (
                    <span className="object-navigator__selected">Selected</span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {sortMode === 'layer' ? (
            <li
              aria-hidden="true"
              className={
                dropTarget?.kind === 'edge' && dropTarget.edge === 'bottom'
                  ? 'object-navigator__drop-edge is-active'
                  : 'object-navigator__drop-edge'
              }
              style={
                virtualized
                  ? {
                      top:
                        VIRTUAL_EDGE_OFFSET +
                        orderedElements.length * VIRTUAL_ROW_STRIDE,
                    }
                  : undefined
              }
              onDragLeave={() =>
                setDropTarget((current) =>
                  current?.kind === 'edge' && current.edge === 'bottom'
                    ? null
                    : current,
                )
              }
              onDragOver={(event) => updateEdgeDropTarget(event, 'bottom')}
              onDrop={(event) => {
                if (draggingIds === null) return;
                event.preventDefault();
                event.stopPropagation();
                onDropAtEdge(draggingIds, 'bottom');
                finishDrag();
              }}
            />
          ) : null}
        </ol>
      )}

      {sortMode === 'layer' ? (
        <section
          className="object-navigator__order"
          aria-labelledby="object-navigator-order-title"
        >
          <div>
            <h3 id="object-navigator-order-title">Layer order</h3>
            <span>{selectedIds.size} selected</span>
          </div>
          <div className="object-navigator__order-actions">
            <button
              type="button"
              disabled={readOnly || !canMoveForward}
              onClick={() => onMoveSelected('forward')}
            >
              Move up one
            </button>
            <button
              type="button"
              disabled={readOnly || !canMoveForward}
              onClick={() => onMoveSelected('to-front')}
            >
              Move to top
            </button>
            <button
              type="button"
              disabled={readOnly || !canMoveBackward}
              onClick={() => onMoveSelected('backward')}
            >
              Move down one
            </button>
            <button
              type="button"
              disabled={readOnly || !canMoveBackward}
              onClick={() => onMoveSelected('to-back')}
            >
              Move to bottom
            </button>
          </div>
        </section>
      ) : null}

      {sortMode !== 'layer' || hoverHint === null ? null : (
        <div
          className="object-navigator__hover-hint"
          key={hoverHint.id}
          role="tooltip"
          style={{ top: hoverHint.top }}
        >
          Shift-click to select multiple objects. Drag a selected object to move
          the selection.
        </div>
      )}
      <span className="sr-only" id="object-navigator-order-hint">
        {sortMode === 'layer'
          ? 'Shift-click to select multiple objects. Drag a selected object to move the selection. Use the Layer order buttons as a keyboard alternative.'
          : 'Sorted from top to bottom. Shift-click to select multiple objects.'}
      </span>
      <div className="object-navigator__footer">
        <button
          type="button"
          className="object-navigator__select-between"
          disabled={!canSelectBetween}
          onClick={() => onSelectRange(idsBetweenSelection)}
        >
          Select all between
        </button>
        {!readOnly ? (
          <button
            type="button"
            className="object-navigator__delete"
            disabled={selectedIds.size === 0}
            onClick={onDeleteSelected}
          >
            Delete selected
          </button>
        ) : null}
      </div>
    </aside>
  );
}
