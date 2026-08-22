/** Applies a bounded semantic recovery patch only to the exact durable base revision it names. */
import type { BoardElement } from '@chalkboard/shared';

import { parseStoredElements } from '../model/boardSerialization';
import { cacheCriticalLocalValue } from './localBoardCache';

const LOCAL_PENDING_BOARD_PATCH_KEY = 'chalkboard:pending-local-board-patch';
const MAX_PATCH_CHANGES = 32;
const MAX_ACCEPTED_BASES = 8;

interface PendingBoardElementChange {
  acceptedBases: BoardElement[];
  next: BoardElement;
}

interface PendingLocalBoardPatch {
  changes: PendingBoardElementChange[];
  elementCount: number;
  version: 1;
}

/** Builds the critical-recovery key for one compact local-board patch. */
export function localPendingBoardPatchKey(boardId: string): string {
  return `${LOCAL_PENDING_BOARD_PATCH_KEY}:${boardId}`;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

function elementEqual(
  first: BoardElement | undefined,
  second: BoardElement | undefined,
): boolean {
  return (
    first === second ||
    (first !== undefined &&
      second !== undefined &&
      JSON.stringify(canonicalValue(first)) ===
        JSON.stringify(canonicalValue(second)))
  );
}

function parseElement(value: unknown): BoardElement | null {
  const [element] = parseStoredElements(JSON.stringify([value]));
  return element ?? null;
}

/** Best-effort removes a patch superseded by durable or complete recovery. */
export function removePendingLocalBoardPatch(boardId: string): void {
  try {
    localStorage.removeItem(localPendingBoardPatchKey(boardId));
  } catch {
    // IndexedDB or a complete pending snapshot remains authoritative.
  }
}

/** Validates a stored patch or deletes malformed replaceable recovery data. */
export function loadPendingLocalBoardPatch(
  boardId: string,
): PendingLocalBoardPatch | null {
  try {
    const serialized = localStorage.getItem(localPendingBoardPatchKey(boardId));
    if (serialized === null) return null;
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { version?: unknown }).version !== 1 ||
      !Number.isSafeInteger(
        (value as { elementCount?: unknown }).elementCount,
      ) ||
      (value as { elementCount: number }).elementCount < 0 ||
      !Array.isArray((value as { changes?: unknown }).changes) ||
      (value as { changes: unknown[] }).changes.length < 1 ||
      (value as { changes: unknown[] }).changes.length > MAX_PATCH_CHANGES
    ) {
      removePendingLocalBoardPatch(boardId);
      return null;
    }
    const changes: PendingBoardElementChange[] = [];
    const ids = new Set<string>();
    for (const candidate of (value as { changes: unknown[] }).changes) {
      if (typeof candidate !== 'object' || candidate === null) {
        removePendingLocalBoardPatch(boardId);
        return null;
      }
      const candidateRecord = candidate as Record<string, unknown>;
      const rawAcceptedBases = candidateRecord.acceptedBases;
      if (
        !Array.isArray(rawAcceptedBases) ||
        rawAcceptedBases.length < 1 ||
        rawAcceptedBases.length > MAX_ACCEPTED_BASES
      ) {
        removePendingLocalBoardPatch(boardId);
        return null;
      }
      const next = parseElement(candidateRecord.next);
      if (next === null || ids.has(next.id)) {
        removePendingLocalBoardPatch(boardId);
        return null;
      }
      const acceptedBases: BoardElement[] = [];
      for (const rawBase of rawAcceptedBases) {
        const base = parseElement(rawBase);
        if (base === null || base.id !== next.id) {
          removePendingLocalBoardPatch(boardId);
          return null;
        }
        acceptedBases.push(base);
      }
      ids.add(next.id);
      changes.push({ acceptedBases, next });
    }
    return {
      changes,
      elementCount: (value as { elementCount: number }).elementCount,
      version: 1,
    };
  } catch {
    removePendingLocalBoardPatch(boardId);
    return null;
  }
}

/**
 * Stages a compact stable-order replacement patch. Returns false for additions,
 * deletions, reordering, large batches, or an incompatible pending chain so the
 * caller can retain the complete-snapshot fallback.
 */
export function cachePendingLocalBoardPatch(
  baseElements: readonly BoardElement[],
  nextElements: readonly BoardElement[],
  boardId: string,
): boolean {
  if (
    baseElements.length !== nextElements.length ||
    baseElements.some(
      (element, index) => element.id !== nextElements[index]?.id,
    )
  ) {
    return false;
  }
  const directChanges = baseElements.flatMap((base, index) => {
    const next = nextElements[index];
    return next === undefined || elementEqual(base, next)
      ? []
      : [{ acceptedBases: [base], next }];
  });
  if (directChanges.length < 1 || directChanges.length > MAX_PATCH_CHANGES) {
    return false;
  }

  const pending = loadPendingLocalBoardPatch(boardId);
  const merged = new Map(
    pending?.changes.map((change) => [change.next.id, change] as const) ?? [],
  );
  if (pending !== null) {
    if (pending.elementCount !== baseElements.length) return false;
    const currentById = new Map(
      baseElements.map((element) => [element.id, element]),
    );
    if (
      pending.changes.some((change) => {
        const current = currentById.get(change.next.id);
        return (
          current === undefined ||
          ![...change.acceptedBases, change.next].some((candidate) =>
            elementEqual(candidate, current),
          )
        );
      })
    ) {
      return false;
    }
  }
  for (const direct of directChanges) {
    const existing = merged.get(direct.next.id);
    if (existing === undefined) {
      merged.set(direct.next.id, direct);
      continue;
    }
    const directBase = direct.acceptedBases[0];
    if (
      directBase === undefined ||
      ![...existing.acceptedBases, existing.next].some((candidate) =>
        elementEqual(candidate, directBase),
      )
    ) {
      return false;
    }
    const acceptedBases = [...existing.acceptedBases];
    if (!acceptedBases.some((base) => elementEqual(base, directBase))) {
      acceptedBases.push(directBase);
    }
    if (acceptedBases.length > MAX_ACCEPTED_BASES) return false;
    merged.set(direct.next.id, { acceptedBases, next: direct.next });
  }
  if (merged.size > MAX_PATCH_CHANGES) return false;

  return cacheCriticalLocalValue(
    localPendingBoardPatchKey(boardId),
    JSON.stringify({
      changes: [...merged.values()],
      elementCount: nextElements.length,
      version: 1,
    } satisfies PendingLocalBoardPatch),
  );
}

/** Applies a patch only when its base fingerprint matches durable elements. */
export function applyPendingLocalBoardPatch(
  elements: BoardElement[],
  boardId: string,
): BoardElement[] {
  const patch = loadPendingLocalBoardPatch(boardId);
  if (patch === null || patch.elementCount !== elements.length) return elements;
  const byId = new Map(patch.changes.map((change) => [change.next.id, change]));
  const currentById = new Map(elements.map((element) => [element.id, element]));
  if (
    patch.changes.some((change) => {
      const current = currentById.get(change.next.id);
      return (
        current === undefined ||
        ![...change.acceptedBases, change.next].some((candidate) =>
          elementEqual(candidate, current),
        )
      );
    })
  ) {
    return elements;
  }
  let changed = false;
  const recovered = elements.map((element) => {
    const change = byId.get(element.id);
    if (change === undefined || elementEqual(element, change.next)) {
      return element;
    }
    if (!change.acceptedBases.some((base) => elementEqual(element, base))) {
      return element;
    }
    changed = true;
    return change.next;
  });
  return changed ? recovered : elements;
}

/** Clears a patch only after durable elements equal its recovered result. */
export function clearCommittedPendingLocalBoardPatch(
  elements: BoardElement[],
  boardId: string,
): void {
  const patch = loadPendingLocalBoardPatch(boardId);
  if (patch === null || patch.elementCount !== elements.length) return;
  const byId = new Map(elements.map((element) => [element.id, element]));
  if (
    patch.changes.every((change) =>
      elementEqual(byId.get(change.next.id), change.next),
    )
  ) {
    removePendingLocalBoardPatch(boardId);
  }
}
