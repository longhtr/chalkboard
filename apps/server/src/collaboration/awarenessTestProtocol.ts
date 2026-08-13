/** Encodes raw Awareness payloads for unit and WebSocket policy tests. */
import * as encoding from 'lib0/encoding';

/** One raw client clock/state tuple encoded into a test Awareness update. */
interface AwarenessTestEntry {
  clientId: number;
  clock: number;
  state: unknown;
}

/** Encodes multiple entries exactly as the Yjs Awareness protocol expects. */
export function awarenessUpdate(
  entries: readonly AwarenessTestEntry[],
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(encoder, entry.clientId);
    encoding.writeVarUint(encoder, entry.clock);
    encoding.writeVarString(encoder, JSON.stringify(entry.state));
  }
  return encoding.toUint8Array(encoder);
}

/** Convenience encoder for a one-client Awareness update. */
export function singleAwarenessUpdate(
  clientId: number,
  clock: number,
  state: unknown,
): Uint8Array {
  return awarenessUpdate([{ clientId, clock, state }]);
}
