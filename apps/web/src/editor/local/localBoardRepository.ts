/**
 * Public local-board API used by application UI. It composes storage, assets,
 * migration, archive import, metadata, duplication, trash, and cross-tab notices
 * so components never coordinate those durable steps independently.
 */
import type { WorkspaceFontChoice } from '../../math/workspaceFontAssets';
import { randomUuid } from '../../randomUuid';
import { parseBoardArchiveIsolated } from '../portability/boardArchiveClient';
import {
  createLocalBoard,
  duplicateLocalBoard,
  initializeLocalBoardStorage,
  listLocalBoards,
  listTrashedLocalBoards,
  loadLocalBoard,
  permanentlyDeleteAllTrashedLocalBoards,
  permanentlyDeleteLocalBoard,
  renameLocalBoard,
  restoreAllLocalBoards,
  restoreLocalBoard,
  saveLocalBoard,
  trashLocalBoard,
  type LocalBoardRecord,
  type LocalBoardSaveResult,
  type LocalBoardStorageInitialization,
  type LocalBoardSummary,
  type LocalBoardWrite,
  type TrashedLocalBoardSummary,
} from './boardStorage';

/** The complete IndexedDB-backed local-board boundary used by React code. */
interface LocalBoardRepository {
  create(title?: string): Promise<LocalBoardSummary>;
  deleteAllPermanently(): Promise<number>;
  deletePermanently(id: string): Promise<void>;
  duplicate(id: string): Promise<LocalBoardSummary | null>;
  initialize(
    preferredBoardId?: string,
  ): Promise<LocalBoardStorageInitialization>;
  importArchive(
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<{
    board: LocalBoardSummary;
    font: WorkspaceFontChoice;
  }>;
  list(): Promise<LocalBoardSummary[]>;
  listTrash(): Promise<TrashedLocalBoardSummary[]>;
  read(id: string): Promise<LocalBoardRecord | null>;
  rename(id: string, title: string): Promise<LocalBoardSummary | null>;
  restore(id: string): Promise<LocalBoardSummary | null>;
  restoreAll(): Promise<number>;
  trash(id: string): Promise<TrashedLocalBoardSummary | null>;
  write(id: string, record: LocalBoardWrite): Promise<LocalBoardSaveResult>;
}

/** Default repository used by application and workspace orchestration. */
export const localBoardRepository: LocalBoardRepository = {
  create: createLocalBoard,
  deleteAllPermanently: permanentlyDeleteAllTrashedLocalBoards,
  deletePermanently: permanentlyDeleteLocalBoard,
  duplicate: duplicateLocalBoard,
  initialize: initializeLocalBoardStorage,

  async importArchive(bytes, signal) {
    const parsed = await parseBoardArchiveIsolated(bytes, signal);
    if (signal?.aborted === true) {
      throw new DOMException(
        'Editable board import was cancelled',
        'AbortError',
      );
    }
    const boardId = randomUuid();
    const timestamp = Date.now();
    const idMap = new Map(
      parsed.elements.map((element) => [element.id, randomUuid()]),
    );
    const importedElementId = (originalId: string): string => {
      const importedId = idMap.get(originalId);
      if (importedId === undefined) {
        throw new Error('Archive element identity could not be regenerated');
      }
      return importedId;
    };
    const elements = parsed.elements.map((element) => ({
      ...element,
      createdBy: 'local',
      id: importedElementId(element.id),
    }));
    const mixedContentByElementId = Object.fromEntries(
      Object.entries(parsed.mixedContentByElementId).map(([id, document]) => {
        return [importedElementId(id), document];
      }),
    );
    await saveLocalBoard(
      {
        createdAt: timestamp,
        elements,
        mixedContentByElementId,
        title: parsed.title,
        updatedAt: timestamp,
      },
      boardId,
    );
    return {
      board: {
        createdAt: timestamp,
        id: boardId,
        title: parsed.title,
        updatedAt: timestamp,
      },
      font: parsed.font,
    };
  },

  list: listLocalBoards,
  listTrash: listTrashedLocalBoards,
  read: loadLocalBoard,
  rename: renameLocalBoard,
  restore: restoreLocalBoard,
  restoreAll: restoreAllLocalBoards,
  trash: trashLocalBoard,
  write: (id, record) => saveLocalBoard(record, id),
};

export type { LocalBoardSummary, TrashedLocalBoardSummary };
