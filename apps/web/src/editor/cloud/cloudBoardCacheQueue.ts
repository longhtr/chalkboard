/**
 * Serializes device-recovery cache writes for cloud boards. Raw updates are
 * count/byte/age bounded and coalesce into a semantic snapshot before overflow.
 */
import * as Y from 'yjs';

import { MAX_BOARD_BYTES } from '../model/limits';

/** Maximum encoded semantic board snapshot retained for cloud recovery. */
export const MAX_CLOUD_RECOVERY_DOCUMENT_BYTES = MAX_BOARD_BYTES;
/** Maximum individual Yjs updates retained before compaction is required. */
export const MAX_PENDING_CLOUD_UPDATE_COUNT = 256;
/** Maximum encoded size of one retained Yjs update. */
export const MAX_PENDING_CLOUD_UPDATE_BYTES = 900_000;
/** Maximum temporary merged update size accepted during queue compaction. */
export const MAX_PENDING_CLOUD_MERGED_BYTES = 8 * 1_024 * 1_024;
/** Aggregate byte bound for an uncompacted pending update queue. */
export const MAX_PENDING_CLOUD_TOTAL_BYTES = MAX_PENDING_CLOUD_MERGED_BYTES;
/** Maximum age before pending device recovery requires explicit intervention. */
export const MAX_PENDING_CLOUD_UPDATE_AGE_MS = 24 * 60 * 60 * 1_000;
/** Maximum boards allowed to wait in the serialized cache-write queue. */
export const MAX_QUEUED_CLOUD_CACHE_BOARDS = 16;

/** Marks invalid state that must be preserved rather than silently discarded. */
export class PreservedCloudRecoveryError extends Error {
  override readonly name = 'PreservedCloudRecoveryError';
}

function appendJsonBytes(
  total: number,
  addition: number,
  maximum: number,
): number {
  return addition > maximum - total ? maximum + 1 : total + addition;
}

function jsonStringByteLength(value: string, maximum: number): number {
  let bytes = 2;
  if (bytes > maximum) return maximum + 1;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let characterBytes: number;
    if (code === 0x22 || code === 0x5c) characterBytes = 2;
    else if (
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      characterBytes = 2;
    } else if (code <= 0x1f) characterBytes = 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        characterBytes = 4;
        index += 1;
      } else characterBytes = 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) characterBytes = 6;
    else if (code <= 0x7f) characterBytes = 1;
    else if (code <= 0x7ff) characterBytes = 2;
    else characterBytes = 3;
    bytes = appendJsonBytes(bytes, characterBytes, maximum);
    if (bytes > maximum) return bytes;
  }
  return bytes;
}

function jsonValueByteLength(
  value: unknown,
  maximum: number,
  ancestors: Set<object>,
): number | null {
  if (value === null) return maximum >= 4 ? 4 : maximum + 1;
  if (typeof value === 'string') return jsonStringByteLength(value, maximum);
  if (typeof value === 'number') {
    const serialized = JSON.stringify(value);
    return serialized.length <= maximum ? serialized.length : maximum + 1;
  }
  if (typeof value === 'boolean') {
    const bytes = value ? 4 : 5;
    return bytes <= maximum ? bytes : maximum + 1;
  }
  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  )
    return null;
  if (typeof value === 'bigint') {
    throw new RangeError('Cloud recovery document contains unsupported data');
  }
  if (ancestors.has(value)) {
    throw new RangeError('Cloud recovery document contains a cycle');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let bytes = 2;
      if (bytes > maximum) return maximum + 1;
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) bytes = appendJsonBytes(bytes, 1, maximum);
        if (bytes > maximum) return bytes;
        const child = jsonValueByteLength(
          value[index],
          maximum - bytes,
          ancestors,
        );
        bytes = appendJsonBytes(bytes, child ?? 4, maximum);
        if (bytes > maximum) return bytes;
      }
      return bytes;
    }
    let bytes = 2;
    let retainedProperties = 0;
    if (bytes > maximum) return maximum + 1;
    for (const [key, propertyValue] of Object.entries(value)) {
      const child = jsonValueByteLength(
        propertyValue,
        maximum - bytes,
        ancestors,
      );
      if (child === null) continue;
      if (retainedProperties > 0) {
        bytes = appendJsonBytes(bytes, 1, maximum);
      }
      bytes = appendJsonBytes(
        bytes,
        jsonStringByteLength(key, maximum - bytes),
        maximum,
      );
      bytes = appendJsonBytes(bytes, 1, maximum);
      bytes = appendJsonBytes(bytes, child, maximum);
      if (bytes > maximum) return bytes;
      retainedProperties += 1;
    }
    return bytes;
  } finally {
    ancestors.delete(value);
  }
}

/** Measures the exact JSON bytes of a semantic recovery snapshot up to its cap. */
export function cloudRecoveryDocumentByteLength(
  elements: readonly unknown[],
  title: string,
): number {
  return (
    jsonValueByteLength(
      { elements, title },
      MAX_CLOUD_RECOVERY_DOCUMENT_BYTES,
      new Set(),
    ) ?? MAX_CLOUD_RECOVERY_DOCUMENT_BYTES + 1
  );
}

/** Rejects a semantic recovery snapshot whose encoded JSON exceeds its cap. */
export function validateCloudRecoveryDocument(
  elements: readonly unknown[],
  title: string,
): void {
  if (
    cloudRecoveryDocumentByteLength(elements, title) >
    MAX_CLOUD_RECOVERY_DOCUMENT_BYTES
  ) {
    throw new RangeError('Cloud recovery document exceeds its byte limit');
  }
}

/** Reports whether appending an update would exceed count or byte policy. */
export function exceedsPendingCloudUpdateLimits(
  count: number,
  totalBytes: number,
  nextUpdateBytes: number,
): boolean {
  return (
    count >= MAX_PENDING_CLOUD_UPDATE_COUNT ||
    nextUpdateBytes > MAX_PENDING_CLOUD_UPDATE_BYTES ||
    totalBytes + nextUpdateBytes > MAX_PENDING_CLOUD_TOTAL_BYTES
  );
}

/** Reports whether pending recovery has exceeded its wall-clock lifetime. */
export function exceedsPendingCloudUpdateAge(
  pendingSince: number,
  now: number,
): boolean {
  return now - pendingSince > MAX_PENDING_CLOUD_UPDATE_AGE_MS;
}

/** In-memory cache write with validated typed update bytes. */
export interface CloudBoardCacheWrite<Element> {
  baselineElements?: Element[];
  baselineTitle?: string;
  elements: Element[];
  pending?: boolean;
  pendingSince?: number;
  pendingUpdates?: Uint8Array[];
  title: string;
  updatedAt: number;
}

/** IndexedDB representation whose update payloads remain untrusted. */
export interface StoredCloudBoardCacheRecord<Element> {
  baselineElements?: Element[];
  baselineTitle?: string;
  elements: Element[];
  id: string;
  pending: boolean;
  pendingSince?: number;
  pendingUpdates?: unknown[];
  schemaVersion: number;
  title: string;
  updatedAt: number;
}

/** Normalizes the pending timestamp, returning null when no recovery is pending. */
export function cloudRecoveryPendingSince({
  fallback,
  pending,
  storedValue,
}: {
  fallback: number;
  pending: boolean;
  storedValue: unknown;
}): number | null {
  if (!pending) return null;
  if (
    typeof storedValue === 'number' &&
    Number.isFinite(storedValue) &&
    storedValue >= 0
  ) {
    return storedValue;
  }
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

/** Validates cached semantic documents and preserves invalid pending recovery. */
export function validateStoredCloudBoardCacheDocuments<Element>(
  record: StoredCloudBoardCacheRecord<Element>,
): boolean {
  try {
    validateCloudRecoveryDocument(record.elements, record.title);
    if (record.baselineElements !== undefined) {
      validateCloudRecoveryDocument(
        record.baselineElements,
        record.baselineTitle ?? record.title,
      );
    }
    return true;
  } catch (error) {
    const hasPendingRecovery =
      record.pending === true ||
      (Array.isArray(record.pendingUpdates) &&
        record.pendingUpdates.length > 0);
    if (hasPendingRecovery) {
      throw new PreservedCloudRecoveryError(
        error instanceof Error ? error.message : 'Cloud recovery is invalid',
        { cause: error },
      );
    }
    return false;
  }
}

function decodePendingUpdate(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return null;
}

function validatedPendingCloudUpdates(
  updates: readonly Uint8Array[],
): Uint8Array[] {
  if (updates.length > MAX_PENDING_CLOUD_UPDATE_COUNT) {
    throw new RangeError('Cloud recovery update count exceeds its limit');
  }
  let totalBytes = 0;
  return updates.map((update) => {
    if (update.byteLength > MAX_PENDING_CLOUD_UPDATE_BYTES) {
      throw new RangeError('Cloud recovery update exceeds its byte limit');
    }
    totalBytes += update.byteLength;
    if (totalBytes > MAX_PENDING_CLOUD_TOTAL_BYTES) {
      throw new RangeError('Cloud recovery updates exceed their byte limit');
    }
    return new Uint8Array(update);
  });
}

/** Validates and merges pending updates when the result remains safely bounded. */
export function compactPendingCloudUpdates(
  updates: readonly Uint8Array[],
  mergeUpdates: (updates: Uint8Array[]) => Uint8Array = Y.mergeUpdates,
): Uint8Array[] {
  const validated = validatedPendingCloudUpdates(updates);
  if (validated.length === 0) return validated;
  // A second empty update forces Yjs to parse a one-entry retained queue.
  const merged = mergeUpdates([...validated, new Uint8Array([0, 0])]);
  if (merged.byteLength > MAX_PENDING_CLOUD_MERGED_BYTES) return [];
  return merged.byteLength <= MAX_PENDING_CLOUD_UPDATE_BYTES
    ? [new Uint8Array(merged)]
    : validated;
}

/** Reconstructs bounded pending state for an in-memory cache write. */
export function validatedCloudBoardCacheState<Element>(
  record: CloudBoardCacheWrite<Element>,
): {
  pending: boolean;
  pendingSince: number | null;
  pendingUpdates: Uint8Array[];
} {
  validateCloudRecoveryDocument(record.elements, record.title);
  if (record.baselineElements !== undefined) {
    validateCloudRecoveryDocument(
      record.baselineElements,
      record.baselineTitle ?? record.title,
    );
  }
  const pendingUpdates = validatedPendingCloudUpdates(
    record.pendingUpdates ?? [],
  );
  const pending = record.pending === true || pendingUpdates.length > 0;
  return {
    pending,
    pendingSince: cloudRecoveryPendingSince({
      fallback: record.updatedAt,
      pending,
      storedValue: record.pendingSince,
    }),
    pendingUpdates,
  };
}

/** Reconstructs persisted binary updates or throws a preservation error. */
export function decodePendingCloudUpdates(value: unknown): Uint8Array[] {
  if (value === undefined) return [];
  try {
    if (!Array.isArray(value)) {
      throw new Error('Cloud recovery updates are corrupt');
    }
    return compactPendingCloudUpdates(
      value.map((update) => {
        const decoded = decodePendingUpdate(update);
        if (decoded === null) {
          throw new Error('Cloud recovery update is corrupt');
        }
        return decoded;
      }),
    );
  } catch (error) {
    throw new PreservedCloudRecoveryError(
      error instanceof Error ? error.message : 'Cloud recovery is corrupt',
      { cause: error },
    );
  }
}

interface PendingWrite<Value> {
  value: Value;
  waiters: {
    reject(reason: unknown): void;
    resolve(): void;
  }[];
}

/** Serializes writes while retaining only the newest not-yet-started value per key. */
export class LatestKeyedWriteQueue<Key, Value> {
  readonly #maximumPendingKeys: number;
  readonly #pending = new Map<Key, PendingWrite<Value>>();
  readonly #write: (key: Key, value: Value) => Promise<void>;
  #idle: Promise<void> = Promise.resolve();
  #resolveIdle: (() => void) | null = null;
  #running = false;

  constructor(
    maximumPendingKeys: number,
    write: (key: Key, value: Value) => Promise<void>,
  ) {
    this.#maximumPendingKeys = maximumPendingKeys;
    this.#write = write;
  }

  enqueue(key: Key, value: Value): Promise<void> {
    return new Promise((resolve, reject) => {
      const pending = this.#pending.get(key);
      if (pending !== undefined) {
        pending.value = value;
        pending.waiters.push({ reject, resolve });
      } else {
        if (this.#pending.size >= this.#maximumPendingKeys) {
          reject(new Error('Cloud cache write queue is full'));
          return;
        }
        this.#pending.set(key, { value, waiters: [{ reject, resolve }] });
      }
      this.#start();
    });
  }

  waitForIdle(): Promise<void> {
    return this.#idle;
  }

  #start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#idle = new Promise((resolve) => {
      this.#resolveIdle = resolve;
    });
    void this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#pending.size > 0) {
        const next = this.#pending.entries().next().value;
        if (next === undefined) break;
        const [key, pending] = next;
        this.#pending.delete(key);
        try {
          await this.#write(key, pending.value);
          pending.waiters.forEach(({ resolve }) => resolve());
        } catch (error) {
          pending.waiters.forEach(({ reject }) => reject(error));
        }
      }
    } finally {
      this.#running = false;
      this.#resolveIdle?.();
      this.#resolveIdle = null;
    }
  }
}
