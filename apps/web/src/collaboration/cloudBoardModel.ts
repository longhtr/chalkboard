/**
 * Canonical Yjs board representation. Metadata, deterministic order, element
 * maps, and structured mixed content reconcile without replacing unchanged
 * shared types, preserving collaborator identity and undo behavior.
 */
import {
  CHALKBOARD_SCHEMA_VERSIONS,
  isEquationElement,
  mixedContentFromYRoot,
  reconcileYMixedContent,
  type BoardElement,
} from '@chalkboard/shared';
import * as Y from 'yjs';

import { parseStoredElements } from '../editor/model/boardSerialization';
import { normalizedBoardTitle } from '../editor/model/boardTitle';
import {
  mixedDocumentFromSource,
  sourceFromMixedDocument,
} from '../math/mixedDocument';

const ROOT = 'board';
const LEGACY_ELEMENTS = 'elements';
const LEGACY_ORDER = 'element-order';
const ELEMENTS = 'element-records-v2';
const ORDER = 'element-order-v2';
const LOCAL_ORIGIN = 'cloud-board-local';
const MIXED_CONTENT = 'mixedContent-v3';
const SCHEMA_VERSION_KEY = 'schema-version';
const SCHEMA_VERSION = CHALKBOARD_SCHEMA_VERSIONS.cloudBoard;
/** Yjs transaction origin reserved for replaying device-cached updates. */
export const CLOUD_BOARD_PENDING_REPLAY_ORIGIN = 'cloud-board-pending-replay';

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((value, index) => value === second[index])
  );
}

/** Rejects future root or structured-content versions before local mutation. */
export function isCloudBoardSchemaSupported(document: Y.Doc): boolean {
  const rootVersion = document.getMap<unknown>(ROOT).get(SCHEMA_VERSION_KEY);
  if (rootVersion !== undefined && rootVersion !== SCHEMA_VERSION) return false;
  const records = document.getMap<Y.Map<unknown>>(ELEMENTS);
  for (const record of records.values()) {
    if (!(record instanceof Y.Map)) continue;
    const mixedRoot = record.get(MIXED_CONTENT);
    if (!(mixedRoot instanceof Y.Map)) continue;
    const mixedVersion = mixedRoot.get('version');
    if (mixedVersion !== undefined && mixedVersion !== 1) return false;
  }
  return true;
}

function decodeElement(id: string, value: unknown): BoardElement | null {
  const candidate = parseStoredElements(JSON.stringify([value]))[0];
  return candidate?.id === id ? candidate : null;
}

function recordValue(record: Y.Map<unknown>): Record<string, unknown> {
  const value = Object.fromEntries(
    [...record.entries()].filter(([key]) => key !== MIXED_CONTENT),
  );
  const mixedRoot = record.get(MIXED_CONTENT);
  const mixedContent =
    mixedRoot instanceof Y.Map ? mixedContentFromYRoot(mixedRoot) : null;
  if (mixedContent !== null && typeof value.strokeColor === 'string') {
    value.source = sourceFromMixedDocument(mixedContent, value.strokeColor);
  }
  return value;
}

function ensureRecord(
  records: Y.Map<Y.Map<unknown>>,
  id: string,
): Y.Map<unknown> {
  const existing = records.get(id);
  if (existing !== undefined) return existing;
  const created = new Y.Map<unknown>();
  records.set(id, created);
  return created;
}

function reconcileEquationContent(
  record: Y.Map<unknown>,
  element: BoardElement,
): void {
  if (!isEquationElement(element)) {
    record.delete(MIXED_CONTENT);
    return;
  }
  const existingMixedRoot = record.get(MIXED_CONTENT);
  const mixedRoot =
    existingMixedRoot instanceof Y.Map
      ? existingMixedRoot
      : new Y.Map<unknown>();
  if (!(existingMixedRoot instanceof Y.Map)) {
    record.set(MIXED_CONTENT, mixedRoot);
  }
  const reconciled = reconcileYMixedContent(
    mixedRoot,
    mixedDocumentFromSource(element.source, element.strokeColor),
  );
  if (reconciled) record.delete('source');
}

function elementProperties(
  element: BoardElement,
): ReadonlyMap<string, unknown> {
  return new Map<string, unknown>(Object.entries(element));
}

function setElementProperties(
  record: Y.Map<unknown>,
  element: BoardElement,
): void {
  const properties = elementProperties(element);
  for (const key of record.keys()) {
    if (key !== MIXED_CONTENT && !properties.has(key)) record.delete(key);
  }
  for (const [key, value] of properties) {
    if (isEquationElement(element) && key === 'source') continue;
    if (JSON.stringify(record.get(key)) !== JSON.stringify(value)) {
      record.set(key, value);
    }
  }
  reconcileEquationContent(record, element);
}

function orderedElements(
  decoded: Map<string, BoardElement>,
  ranks: Map<string, number>,
  legacyOrder: string[],
): BoardElement[] {
  const legacyRanks = new Map(legacyOrder.map((id, index) => [id, index]));
  return [...decoded.values()].sort((first, second) => {
    const firstRank =
      ranks.get(first.id) ??
      legacyRanks.get(first.id) ??
      Number.MAX_SAFE_INTEGER;
    const secondRank =
      ranks.get(second.id) ??
      legacyRanks.get(second.id) ??
      Number.MAX_SAFE_INTEGER;
    return firstRank - secondRank || first.id.localeCompare(second.id);
  });
}

/** Decodes current records plus compatible legacy records in deterministic order. */
export function readCloudBoard(document: Y.Doc): {
  elements: BoardElement[];
  title: string;
} {
  const root = document.getMap<unknown>(ROOT);
  const records = document.getMap<Y.Map<unknown>>(ELEMENTS);
  const ranks = document.getMap<number>(ORDER);
  const legacyElements = document.getMap<string>(LEGACY_ELEMENTS);
  const legacyOrder = document.getArray<string>(LEGACY_ORDER).toArray();
  const decoded = new Map<string, BoardElement>();

  for (const [id, record] of records.entries()) {
    if (!(record instanceof Y.Map)) continue;
    const element = decodeElement(id, recordValue(record));
    if (element !== null) decoded.set(id, element);
  }
  for (const [id, serialized] of legacyElements.entries()) {
    if (decoded.has(id)) continue;
    try {
      const element = decodeElement(id, JSON.parse(serialized));
      if (element !== null) decoded.set(id, element);
    } catch {
      // Ignore malformed legacy records instead of breaking the room.
    }
  }

  return {
    elements: orderedElements(decoded, new Map(ranks.entries()), legacyOrder),
    title:
      typeof root.get('title') === 'string'
        ? normalizedBoardTitle(root.get('title') as string)
        : normalizedBoardTitle(''),
  };
}

/** Replays cached updates and returns only updates that changed the document. */
export function applyPendingCloudUpdates(
  document: Y.Doc,
  updates: Uint8Array[],
): Uint8Array[] {
  if (!isCloudBoardSchemaSupported(document)) return [...updates];
  const remaining: Uint8Array[] = [];
  for (const update of updates) {
    const before = Y.encodeStateVector(document);
    Y.applyUpdate(document, update, CLOUD_BOARD_PENDING_REPLAY_ORIGIN);
    if (!equalBytes(before, Y.encodeStateVector(document))) {
      remaining.push(update);
    }
  }
  return remaining;
}

/** Creates undo history scoped to semantic local board transactions. */
export function createCloudBoardUndoManager(document: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(
    [
      document.getMap<unknown>(ROOT),
      document.getMap<Y.Map<unknown>>(ELEMENTS),
      document.getMap<number>(ORDER),
    ],
    {
      // One gesture, one undo step. A drag publishes a revision every frame, so
      // capturing each separately buried a resize under a dozen entries and the
      // first undo moved the shape by a pixel or two -- invisible, and read as
      // undo doing nothing. Frames of one drag arrive milliseconds apart and
      // merge; two deliberate edits are further apart than this and stay
      // separate.
      captureTimeout: 400,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    },
  );
}

/** Reconciles a complete ordered board into Yjs, returning false for future schemas. */
export function writeCloudBoard(
  document: Y.Doc,
  elements: BoardElement[],
  title: string,
): boolean {
  if (!isCloudBoardSchemaSupported(document)) return false;
  const root = document.getMap<unknown>(ROOT);
  const records = document.getMap<Y.Map<unknown>>(ELEMENTS);
  const ranks = document.getMap<number>(ORDER);
  const legacyElements = document.getMap<string>(LEGACY_ELEMENTS);
  const legacyOrder = document.getArray<string>(LEGACY_ORDER);
  document.transact(() => {
    root.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
    root.set('initialized', true);
    const normalizedTitle = normalizedBoardTitle(title);
    if (root.get('title') !== normalizedTitle) {
      root.set('title', normalizedTitle);
    }
    const retained = new Set(elements.map((element) => element.id));
    for (const id of records.keys()) {
      if (!retained.has(id)) records.delete(id);
    }
    for (const id of ranks.keys()) {
      if (!retained.has(id)) ranks.delete(id);
    }
    elements.forEach((element, index) => {
      setElementProperties(ensureRecord(records, element.id), element);
      if (ranks.get(element.id) !== index) ranks.set(element.id, index);
    });
    legacyElements.clear();
    if (legacyOrder.length > 0) legacyOrder.delete(0, legacyOrder.length);
  }, LOCAL_ORIGIN);
  return true;
}

/** Publishes identity-based element changes without rewriting stable order entries. */
export function updateCloudBoard(
  document: Y.Doc,
  previousElements: BoardElement[],
  elements: BoardElement[],
  title: string,
): boolean {
  const orderIsStable =
    previousElements.length === elements.length &&
    previousElements.every(
      (element, index) => element.id === elements[index]?.id,
    );
  if (!orderIsStable) return writeCloudBoard(document, elements, title);
  if (!isCloudBoardSchemaSupported(document)) return false;
  const root = document.getMap<unknown>(ROOT);
  const records = document.getMap<Y.Map<unknown>>(ELEMENTS);
  document.transact(() => {
    root.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
    root.set('initialized', true);
    const normalizedTitle = normalizedBoardTitle(title);
    if (root.get('title') !== normalizedTitle) {
      root.set('title', normalizedTitle);
    }
    elements.forEach((element, index) => {
      if (element !== previousElements[index]) {
        setElementProperties(ensureRecord(records, element.id), element);
      }
    });
  }, LOCAL_ORIGIN);
  return true;
}

/** Applies only changes made since a cached baseline onto the current shared board. */
export function applyOfflineBoardDiff(
  document: Y.Doc,
  baseline: { elements: BoardElement[]; title: string },
  offline: { elements: BoardElement[]; title: string },
): boolean {
  if (!isCloudBoardSchemaSupported(document)) return false;
  const root = document.getMap<unknown>(ROOT);
  const records = document.getMap<Y.Map<unknown>>(ELEMENTS);
  const ranks = document.getMap<number>(ORDER);
  const baselineById = new Map(
    baseline.elements.map((element) => [element.id, element]),
  );
  const offlineById = new Map(
    offline.elements.map((element) => [element.id, element]),
  );

  document.transact(() => {
    root.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
    root.set('initialized', true);
    if (baseline.title !== offline.title) {
      root.set('title', normalizedBoardTitle(offline.title));
    }

    for (const id of baselineById.keys()) {
      if (!offlineById.has(id)) {
        records.delete(id);
        ranks.delete(id);
      }
    }
    for (const [id, element] of offlineById) {
      const baselineElement = baselineById.get(id);
      const record = ensureRecord(records, id);
      if (baselineElement === undefined) {
        setElementProperties(record, element);
        continue;
      }
      const before = elementProperties(baselineElement);
      const after = elementProperties(element);
      let sourceChanged = false;
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        if (JSON.stringify(before.get(key)) === JSON.stringify(after.get(key)))
          continue;
        if (key === 'source' && isEquationElement(element)) {
          sourceChanged = true;
        } else if (!after.has(key)) record.delete(key);
        else record.set(key, after.get(key));
      }
      if (sourceChanged) reconcileEquationContent(record, element);
    }

    const baselineOrder = baseline.elements.map(({ id }) => id);
    const offlineOrder = offline.elements.map(({ id }) => id);
    if (JSON.stringify(baselineOrder) !== JSON.stringify(offlineOrder)) {
      offlineOrder.forEach((id, index) => ranks.set(id, index));
    }
  }, 'cloud-board-offline-recovery');
  return true;
}
