/** Internal durable record types shared by the local database, repository, migration, and export boundaries. */
import {
  CHALKBOARD_SCHEMA_VERSIONS,
  type BoardElement,
  type MixedContentDocument,
} from '@chalkboard/shared';

import type { StoredCloudBoardCacheRecord } from '../cloud/cloudBoardCacheQueue';
import type { StoredBoardElement } from './localBoardImageStorage';

/** IndexedDB key prefix for authoritative local boards. */
export const LOCAL_BOARD_PREFIX = 'local:';
/** IndexedDB key prefix for disposable cloud recovery caches. */
export const CLOUD_BOARD_PREFIX = 'cloud:';
/** Current version of the persisted local-board record. */
export const LOCAL_BOARD_SCHEMA_VERSION =
  CHALKBOARD_SCHEMA_VERSIONS.localBoardRecord;
/** Reversible deletion lifetime before automatic local purge. */
export const LOCAL_BOARD_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** Versioned IndexedDB board row with image references instead of data URLs. */
export interface StoredBoardRecord {
  createdAt?: number;
  elements: StoredBoardElement[];
  id: string;
  mixedContentByElementId?: Record<string, MixedContentDocument>;
  schemaVersion: number;
  title: string;
  trashedAt?: number;
  updatedAt: number;
}

/** Fully hydrated authoritative local board consumed by the editor. */
export interface LocalBoardRecord {
  createdAt: number;
  elements: BoardElement[];
  mixedContentByElementId: Record<string, MixedContentDocument>;
  title: string;
  updatedAt: number;
}

/** Lightweight live-board metadata used by the local library. */
export interface LocalBoardSummary {
  createdAt: number;
  id: string;
  title: string;
  updatedAt: number;
}

/** Local-board metadata augmented with its reversible-deletion time. */
export interface TrashedLocalBoardSummary extends LocalBoardSummary {
  trashedAt: number;
}

/** Result of migration, purge, and preferred-board selection at startup. */
export interface LocalBoardStorageInitialization {
  boards: LocalBoardSummary[];
  migratedBoardId: string | null;
  preferredBoardFound: boolean;
  selectedBoardId: string;
}

/** Caller-supplied semantic content for an optimistic-concurrency write. */
export type LocalBoardWrite = Omit<
  LocalBoardRecord,
  'createdAt' | 'mixedContentByElementId'
> & {
  createdAt?: number;
  mixedContentByElementId?: Record<string, MixedContentDocument>;
  /** Reuses the exact crash-recovery snapshot instead of serializing again. */
  serializedElementsForCaches?: string;
};

/** Successful commit or the current winner of a stale-revision race. */
export type LocalBoardSaveResult =
  { committed: true } | { committed: false; current: LocalBoardRecord };

/** Typed IndexedDB row for one disposable cloud recovery cache. */
export type CloudBoardCacheRecord = StoredCloudBoardCacheRecord<BoardElement>;

/** Builds the authoritative IndexedDB key for one local board identifier. */
export function storedLocalBoardId(boardId: string): string {
  return `${LOCAL_BOARD_PREFIX}${boardId}`;
}
