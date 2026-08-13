/**
 * Validates Yjs Awareness updates, which carry ephemeral cursors, selections,
 * and user labels. State is decoded into a temporary plan, checked for limits
 * and client ownership, then applied; malformed presence never mutates a room.
 */
import * as decoding from 'lib0/decoding';
import * as awarenessProtocol from 'y-protocols/awareness';

import { isErrorInstance } from '../operations/errorDiagnostics.js';

/** Per-update, connection, and room bounds for ephemeral presence state. */
export interface CollaborationAwarenessLimits {
  clientsPerConnection: number;
  historicalClientsPerRoom: number;
  roomBytes: number;
  roomClients: number;
  updateBytes: number;
}

const DEFAULT_COLLABORATION_AWARENESS_LIMITS: CollaborationAwarenessLimits = {
  clientsPerConnection: 32,
  historicalClientsPerRoom: 2_048,
  roomBytes: 512 * 1_024,
  roomClients: 1_024,
  updateBytes: 64 * 1_024,
};

/** Classifies malformed policy input separately from byte-limit rejection. */
export class CollaborationAwarenessAdmissionError extends Error {
  constructor(
    readonly kind: 'policy' | 'size',
    message: string,
  ) {
    super(message);
    this.name = 'CollaborationAwarenessAdmissionError';
  }
}

interface AwarenessEntry {
  clientId: number;
  encodedBytes: number;
  state: unknown;
}

interface CollaborationAwarenessPlan {
  clientIds: number[];
}

function parseAwarenessUpdate(
  update: Uint8Array,
  maximumEntries: number,
): AwarenessEntry[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  if (count > maximumEntries) {
    throw new CollaborationAwarenessAdmissionError(
      'policy',
      'Awareness update contains too many entries',
    );
  }
  const entries: AwarenessEntry[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const entryStartedAt = decoder.pos;
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder)) as unknown;
    if (state !== null && (typeof state !== 'object' || Array.isArray(state))) {
      throw new CollaborationAwarenessAdmissionError(
        'policy',
        'Awareness state must be an object or null',
      );
    }
    if (seen.has(clientId)) {
      throw new CollaborationAwarenessAdmissionError(
        'policy',
        'Awareness update contains a duplicate client identifier',
      );
    }
    seen.add(clientId);
    entries.push({
      clientId,
      encodedBytes: decoder.pos - entryStartedAt + 1,
      state,
    });
  }
  if (decoder.pos !== update.byteLength) {
    throw new CollaborationAwarenessAdmissionError(
      'policy',
      'Awareness update contains trailing data',
    );
  }
  return entries;
}

/** Tracks client ownership and validates Awareness updates before mutation. */
export class CollaborationAwarenessAdmission<TOwner extends object> {
  private readonly encodedStateBytes = new Map<number, number>();

  constructor(
    private readonly limits: CollaborationAwarenessLimits = DEFAULT_COLLABORATION_AWARENESS_LIMITS,
  ) {}

  inspect(
    update: Uint8Array,
    controlledClients: ReadonlySet<number>,
    owners: ReadonlyMap<number, TOwner>,
    owner: TOwner,
    awareness: awarenessProtocol.Awareness,
  ): CollaborationAwarenessPlan {
    if (update.byteLength > this.limits.updateBytes) {
      throw new CollaborationAwarenessAdmissionError(
        'size',
        'Awareness update exceeds the byte limit',
      );
    }
    let entries: AwarenessEntry[];
    try {
      entries = parseAwarenessUpdate(update, this.limits.clientsPerConnection);
    } catch (error) {
      if (isErrorInstance(error, CollaborationAwarenessAdmissionError)) {
        throw error;
      }
      throw new CollaborationAwarenessAdmissionError(
        'policy',
        'Awareness update is malformed',
      );
    }
    const nextControlled = new Set(controlledClients);
    let projectedRoomBytes = [...this.encodedStateBytes.values()].reduce(
      (total, bytes) => total + bytes,
      0,
    );
    let projectedRoomClients = awareness.getStates().size;
    let projectedHistoricalClients = awareness.meta.size;
    for (const entry of entries) {
      const existingOwner = owners.get(entry.clientId);
      if (existingOwner !== undefined && existingOwner !== owner) {
        throw new CollaborationAwarenessAdmissionError(
          'policy',
          'Awareness client identifier belongs to another connection',
        );
      }
      const existingBytes = this.encodedStateBytes.get(entry.clientId) ?? 0;
      const active = awareness.getStates().has(entry.clientId);
      const historical = awareness.meta.has(entry.clientId);
      if (entry.state === null) {
        if (existingOwner !== owner) {
          throw new CollaborationAwarenessAdmissionError(
            'policy',
            'Awareness removal is not owned by this connection',
          );
        }
        nextControlled.delete(entry.clientId);
        projectedRoomBytes -= existingBytes;
        if (active) projectedRoomClients -= 1;
      } else {
        nextControlled.add(entry.clientId);
        projectedRoomBytes += entry.encodedBytes - existingBytes;
        if (!active) projectedRoomClients += 1;
        if (!historical) projectedHistoricalClients += 1;
      }
    }
    if (nextControlled.size > this.limits.clientsPerConnection) {
      throw new CollaborationAwarenessAdmissionError(
        'policy',
        'Connection controls too many awareness clients',
      );
    }
    if (projectedRoomClients > this.limits.roomClients) {
      throw new CollaborationAwarenessAdmissionError(
        'policy',
        'Room contains too many awareness clients',
      );
    }
    if (projectedHistoricalClients > this.limits.historicalClientsPerRoom) {
      throw new CollaborationAwarenessAdmissionError(
        'policy',
        'Room contains too many historical awareness clients',
      );
    }
    if (projectedRoomBytes > this.limits.roomBytes) {
      throw new CollaborationAwarenessAdmissionError(
        'size',
        'Room awareness state exceeds the byte limit',
      );
    }
    return { clientIds: entries.map((entry) => entry.clientId) };
  }

  commit(
    plan: CollaborationAwarenessPlan,
    awareness: awarenessProtocol.Awareness,
  ): void {
    for (const clientId of plan.clientIds) {
      if (awareness.getStates().has(clientId)) {
        this.encodedStateBytes.set(
          clientId,
          awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId])
            .byteLength,
        );
      } else {
        this.encodedStateBytes.delete(clientId);
      }
    }
  }

  remove(clientIds: readonly number[]): void {
    for (const clientId of clientIds) this.encodedStateBytes.delete(clientId);
  }
}
