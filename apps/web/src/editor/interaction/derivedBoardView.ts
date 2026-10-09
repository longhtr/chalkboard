/**
 * Incremental read model over committed board elements. It reuses spatial and
 * equation indexes across sparse changes, then overlays drafts/previews only at
 * query time so transient edits never become committed state.
 */
import {
  boundsIntersect,
  rotatedElementBounds,
  isEquationElement,
  type BoardElement,
  type Bounds,
  type Camera,
  type EquationElement,
} from '@chalkboard/shared';

import {
  editorDocumentReducer,
  initialEditorDocumentState,
  type EditorDocumentAction,
  type EditorDocumentState,
} from '../model/editorState';
import { ElementSpatialIndex } from './elementSpatialIndex';
import { worldViewportBounds, type ViewportSize } from './viewportCulling';

const MAX_INCREMENTAL_REPLACEMENTS = 512;

interface OrderedElement {
  element: BoardElement;
  order: number;
}

interface IncrementalDerivedState {
  baseById: ReadonlyMap<string, OrderedElement>;
  equationIndexById: ReadonlyMap<string, number>;
  equations: readonly EquationElement[];
  orderedIds: readonly string[];
  replacementsById: ReadonlyMap<string, OrderedElement>;
  spatialIndex: ElementSpatialIndex;
}

interface ActiveEquationDraft {
  draft: EquationElement;
  height: number;
  id: string;
  isNew: boolean;
  source: string;
  width: number;
}

interface EditorDocumentModel {
  derivedBoardView: DerivedBoardView;
  document: EditorDocumentState;
}

interface ViewportQueryOptions {
  /**
   * Keeps the active DOM editor mounted while the camera is temporarily moved
   * away from it. Ordinary preview replacements remain viewport-bounded.
   */
  retainReplacement?: boolean;
  replacement?: BoardElement | undefined;
  replacements?: readonly BoardElement[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valuesEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => valuesEqual(value, second[index]))
    );
  }
  if (!isRecord(first) || !isRecord(second)) return false;
  const firstRecord = first;
  const secondRecord = second;
  const firstKeys = Object.keys(firstRecord);
  const secondKeys = Object.keys(secondRecord);
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every(
      (key) =>
        Object.hasOwn(secondRecord, key) &&
        valuesEqual(firstRecord[key], secondRecord[key]),
    )
  );
}

function elementsEqual(first: BoardElement, second: BoardElement): boolean {
  return first === second || valuesEqual(first, second);
}

/** Creates committed history plus the incrementally maintained derived board view. */
export function createEditorDocumentModel(
  present: BoardElement[] = [],
): EditorDocumentModel {
  return {
    derivedBoardView: new DerivedBoardView(present),
    document: { ...initialEditorDocumentState, present },
  };
}

/** Keeps the committed document and its reusable indexes in one reducer. */
export function editorDocumentModelReducer(
  model: EditorDocumentModel,
  action: EditorDocumentAction,
): EditorDocumentModel {
  const document = editorDocumentReducer(model.document, action);
  if (document === model.document) return model;
  return {
    derivedBoardView:
      document.present === model.document.present
        ? model.derivedBoardView
        : DerivedBoardView.derive(document.present, model.derivedBoardView),
    document,
  };
}

/**
 * Reusable indexes and ordered collections derived from one committed board.
 * Drafts are overlaid at query time so character-frequency editor updates do
 * not rebuild or scan the complete committed element array.
 */
export class DerivedBoardView {
  private readonly baseById: ReadonlyMap<string, OrderedElement>;
  private readonly equationIndexById: ReadonlyMap<string, number>;
  private readonly equations: readonly EquationElement[];
  private readonly orderedIds: readonly string[];
  private readonly replacementElements: readonly BoardElement[];
  private readonly replacementsById: ReadonlyMap<string, OrderedElement>;
  private readonly spatialIndex: ElementSpatialIndex;

  constructor(
    elements: readonly BoardElement[],
    incremental?: IncrementalDerivedState,
  ) {
    if (incremental !== undefined) {
      this.baseById = incremental.baseById;
      this.equationIndexById = incremental.equationIndexById;
      this.equations = incremental.equations;
      this.orderedIds = incremental.orderedIds;
      this.replacementsById = incremental.replacementsById;
      this.replacementElements = [...incremental.replacementsById.values()].map(
        ({ element }) => element,
      );
      this.spatialIndex = incremental.spatialIndex;
      return;
    }

    const baseById = new Map<string, OrderedElement>();
    const equationIndexById = new Map<string, number>();
    const equations: EquationElement[] = [];
    elements.forEach((element, order) => {
      baseById.set(element.id, { element, order });
      if (isEquationElement(element)) {
        equationIndexById.set(element.id, equations.length);
        equations.push(element);
      }
    });
    this.baseById = baseById;
    this.equationIndexById = equationIndexById;
    this.equations = equations;
    this.orderedIds = elements.map(({ id }) => id);
    this.replacementElements = [];
    this.replacementsById = new Map();
    this.spatialIndex = new ElementSpatialIndex(elements);
  }

  /**
   * Reuses the full committed indexes when IDs and order are stable. Changed
   * records form a bounded overlay; large edits and structural changes rebuild.
   */
  static derive(
    elements: readonly BoardElement[],
    previous: DerivedBoardView,
  ): DerivedBoardView {
    if (elements.length !== previous.orderedIds.length) {
      return new DerivedBoardView(elements);
    }

    const changed: { element: BoardElement; order: number }[] = [];
    for (let order = 0; order < elements.length; order += 1) {
      const element = elements[order];
      if (element === undefined || element.id !== previous.orderedIds[order]) {
        return new DerivedBoardView(elements);
      }
      const previousElement = previous.get(element.id);
      if (previousElement === undefined) return new DerivedBoardView(elements);
      if (!elementsEqual(element, previousElement)) {
        if (isEquationElement(element) !== isEquationElement(previousElement)) {
          return new DerivedBoardView(elements);
        }
        changed.push({ element, order });
      }
    }
    if (changed.length === 0) return previous;

    const replacementsById = new Map(previous.replacementsById);
    for (const { element, order } of changed) {
      const base = previous.baseById.get(element.id);
      if (base === undefined) return new DerivedBoardView(elements);
      if (elementsEqual(element, base.element))
        replacementsById.delete(element.id);
      else replacementsById.set(element.id, { element, order });
    }
    if (replacementsById.size > MAX_INCREMENTAL_REPLACEMENTS) {
      return new DerivedBoardView(elements);
    }

    let equations = previous.equations;
    if (changed.some(({ element }) => isEquationElement(element))) {
      const updated = [...equations];
      for (const { element } of changed) {
        if (!isEquationElement(element)) continue;
        const equationIndex = previous.equationIndexById.get(element.id);
        if (equationIndex === undefined) return new DerivedBoardView(elements);
        updated[equationIndex] = element;
      }
      equations = updated;
    }

    return new DerivedBoardView(elements, {
      baseById: previous.baseById,
      equationIndexById: previous.equationIndexById,
      equations,
      orderedIds: previous.orderedIds,
      replacementsById,
      spatialIndex: previous.spatialIndex,
    });
  }

  get(id: string | null | undefined): BoardElement | undefined {
    return id === null || id === undefined
      ? undefined
      : this.entryForId(id)?.element;
  }

  activeEquation(
    editing: ActiveEquationDraft | null,
  ): EquationElement | undefined {
    if (editing === null) return undefined;
    const element = editing.isNew ? editing.draft : this.get(editing.id);
    if (element === undefined || !isEquationElement(element)) return undefined;
    return {
      ...element,
      height: editing.height,
      source: editing.source,
      width: editing.width,
    };
  }

  overlayDraft(
    elements: readonly BoardElement[],
    replacement?: BoardElement,
  ): readonly BoardElement[] {
    return replacement === undefined
      ? elements
      : this.overlayReplacements(elements, [replacement]);
  }

  overlayPreview(
    elements: readonly BoardElement[],
    replacements: readonly BoardElement[],
  ): readonly BoardElement[] {
    return replacements.length === 0
      ? elements
      : this.overlayReplacements(elements, replacements);
  }

  elementForId(
    id: string | null | undefined,
    replacements: readonly BoardElement[] = [],
  ): BoardElement | undefined {
    if (id === null || id === undefined) return undefined;
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      const replacement = replacements[index];
      if (replacement?.id === id) return replacement;
    }
    return this.get(id);
  }

  elementsForIds(
    ids: readonly string[],
    replacements: readonly BoardElement[] = [],
  ): BoardElement[] {
    const replacementById = new Map(
      replacements.map((element) => [element.id, element]),
    );
    const selected = new Map<number, BoardElement>();
    const newReplacements: BoardElement[] = [];
    const includedNewIds = new Set<string>();
    for (const id of ids) {
      const entry = this.entryForId(id);
      if (entry !== undefined) {
        selected.set(entry.order, replacementById.get(id) ?? entry.element);
      } else {
        const replacement = replacementById.get(id);
        if (replacement !== undefined && !includedNewIds.has(id)) {
          newReplacements.push(replacement);
          includedNewIds.add(id);
        }
      }
    }
    return [
      ...[...selected.entries()]
        .sort(([first], [second]) => first - second)
        .map(([, element]) => element),
      ...newReplacements,
    ];
  }

  equationElements(replacement?: EquationElement): readonly EquationElement[] {
    if (replacement === undefined) return this.equations;
    return this.overlayReplacement(this.equations, replacement);
  }

  queryViewport(
    camera: Camera,
    viewport: ViewportSize,
    screenMargin = 0,
    options: ViewportQueryOptions = {},
  ): BoardElement[] {
    const viewportBounds = worldViewportBounds(camera, viewport, screenMargin);
    let queried = this.spatialIndex.queryViewport(
      camera,
      viewport,
      screenMargin,
    );
    if (this.replacementElements.length > 0) {
      queried = this.overlayReplacements(
        queried,
        this.replacementElements,
        (element) => this.intersects(element, viewportBounds),
      );
    }

    const {
      replacement,
      replacements = [],
      retainReplacement = false,
    } = options;
    if (replacement === undefined && replacements.length === 0) return queried;

    const allReplacements =
      replacement === undefined ? replacements : [...replacements, replacement];
    return this.overlayReplacements(queried, allReplacements, (element) =>
      replacement?.id === element.id && retainReplacement
        ? true
        : this.intersects(element, viewportBounds),
    );
  }

  private entryForId(id: string): OrderedElement | undefined {
    return this.replacementsById.get(id) ?? this.baseById.get(id);
  }

  private intersects(element: BoardElement, bounds: Bounds): boolean {
    return boundsIntersect(rotatedElementBounds(element), bounds);
  }

  private overlayReplacement<Element extends BoardElement>(
    queried: readonly Element[],
    replacement: Element,
  ): Element[] {
    return this.overlayReplacements(queried, [replacement]);
  }

  private overlayReplacements<Element extends BoardElement>(
    queried: readonly Element[],
    replacements: readonly Element[],
    include: (element: Element) => boolean = () => true,
  ): Element[] {
    const replacementById = new Map<
      string,
      { element: Element; replacementOrder: number }
    >();
    replacements.forEach((element, replacementOrder) => {
      replacementById.set(element.id, { element, replacementOrder });
    });
    const consumed = new Set<string>();
    const ordered: { element: Element; order: number }[] = [];

    for (const element of queried) {
      const replacement = replacementById.get(element.id);
      if (replacement === undefined) {
        ordered.push({
          element,
          order: this.entryForId(element.id)?.order ?? Number.MAX_SAFE_INTEGER,
        });
        continue;
      }
      consumed.add(element.id);
      if (include(replacement.element)) {
        ordered.push({
          element: replacement.element,
          order:
            this.entryForId(element.id)?.order ??
            this.baseById.size + replacement.replacementOrder,
        });
      }
    }

    for (const [id, replacement] of replacementById) {
      if (consumed.has(id) || !include(replacement.element)) continue;
      ordered.push({
        element: replacement.element,
        order:
          this.entryForId(id)?.order ??
          this.baseById.size + replacement.replacementOrder,
      });
    }

    return ordered
      .sort((first, second) => first.order - second.order)
      .map(({ element }) => element);
  }
}
