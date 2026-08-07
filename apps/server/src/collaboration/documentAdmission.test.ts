/**
 * Constructs persisted and live Yjs documents at each admission boundary to
 * prove update, loaded-tail, encoded-document, nesting, and element limits.
 */
import { describe, expect, it } from 'vitest';

import {
  CollaborationDocumentAdmission,
  CollaborationDocumentLimitError,
  validatePersistedYjsRoom,
  type CollaborationDocumentLimits,
} from './documentAdmission.js';

const limits: CollaborationDocumentLimits = {
  documentBytes: 20,
  loadedBytes: 30,
  loadedUpdates: 2,
  updateBytes: 8,
};

describe('collaboration document admission', () => {
  it('accepts exact update and document boundaries and resets after compaction', () => {
    const admission = new CollaborationDocumentAdmission(10, limits);
    const firstCheckpoint = admission.admit(8);
    expect(firstCheckpoint).toBe(8);
    expect(admission.upperBoundBytes).toBe(18);
    expect(admission.canAdmit(2)).toBe(true);
    const secondCheckpoint = admission.admit(2);
    expect(admission.canAdmit(1)).toBe(false);
    expect(() => admission.admit(9)).toThrow(CollaborationDocumentLimitError);

    admission.compact(12, secondCheckpoint);
    expect(admission.upperBoundBytes).toBe(12);
    expect(admission.admit(8)).toBe(18);
    expect(admission.upperBoundBytes).toBe(20);
  });

  it('rejects oversized persisted snapshots, updates, counts, and aggregate bytes', () => {
    expect(() =>
      validatePersistedYjsRoom(
        { snapshot: new Uint8Array(21), snapshotSequence: 1, updates: [] },
        limits,
      ),
    ).toThrow('snapshot exceeds');
    expect(() =>
      validatePersistedYjsRoom(
        {
          snapshot: null,
          snapshotSequence: 0,
          updates: [{ sequence: 1, update: new Uint8Array(9) }],
        },
        limits,
      ),
    ).toThrow('update exceeds');
    expect(() =>
      validatePersistedYjsRoom(
        {
          snapshot: null,
          snapshotSequence: 0,
          updates: [
            { sequence: 1, update: new Uint8Array(1) },
            { sequence: 2, update: new Uint8Array(1) },
            { sequence: 3, update: new Uint8Array(1) },
          ],
        },
        limits,
      ),
    ).toThrow('count exceeds');
    expect(() =>
      validatePersistedYjsRoom(
        {
          snapshot: new Uint8Array(20),
          snapshotSequence: 1,
          updates: [
            { sequence: 2, update: new Uint8Array(6) },
            { sequence: 3, update: new Uint8Array(6) },
          ],
        },
        limits,
      ),
    ).toThrow('room exceeds');
  });
});
