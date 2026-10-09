/** Proves an append failure closes affected clients without issuing a false durable acknowledgement. */
import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_SYNC,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { waitForTestCondition as waitFor } from '../test/assertions.js';

const TEST_BOARD_ID = '11111111-1111-4111-8111-111111111111';

class FailureClient {
  readonly acknowledgements: number[] = [];
  readonly document = new Y.Doc();
  readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.send(encoding.toUint8Array(encoder));
    });
    this.socket.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data as Buffer));
      const type = decoding.readVarUint(decoder);
      if (type === COLLABORATION_MESSAGE_ACKNOWLEDGEMENT) {
        this.acknowledgements.push(decoding.readVarUint(decoder));
        return;
      }
      if (type !== COLLABORATION_MESSAGE_SYNC) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.readSyncMessage(
        decoder,
        encoder,
        this.document,
        this.socket,
      );
      if (encoding.length(encoder) > 1) {
        this.socket.send(encoding.toUint8Array(encoder));
      }
    });
  }

  async opened(): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve, reject) => {
        this.socket.once('open', resolve);
        this.socket.once('error', reject);
      });
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.document);
    this.socket.send(encoding.toUint8Array(encoder));
  }

  close(): void {
    this.socket.close();
    this.document.destroy();
  }
}

it('closes without acknowledging a failed append and reloads only durable state', async () => {
  const durableDocument = new Y.Doc();
  durableDocument.getText('value').insert(0, 'durable');
  const durableUpdate = Y.encodeStateAsUpdate(durableDocument);
  let loads = 0;
  const app = buildApp({
    config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
    database: {
      close: async () => undefined,
      collaboration: {
        appendUpdate: async () => {
          throw new Error('database unavailable');
        },
        compact: async () => undefined,
        loadRoom: async () => {
          loads += 1;
          return {
            snapshot: null,
            snapshotSequence: 0,
            updates: [{ sequence: 1, update: durableUpdate }],
          };
        },
      },
      ping: async () => undefined,
    },
  });
  const clients: FailureClient[] = [];
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const url = `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`;
    const failing = new FailureClient(url);
    clients.push(failing);
    await failing.opened();
    await waitFor(
      () => failing.document.getText('value').toString() === 'durable',
    );
    const closed = new Promise<number>((resolve) =>
      failing.socket.once('close', resolve),
    );

    failing.document.getText('value').insert(7, ' but not stored');

    await expect(closed).resolves.toBe(1011);
    expect(failing.acknowledgements).toEqual([]);
    await waitFor(async () => {
      const metrics = await app.inject({ method: 'GET', url: '/metrics' });
      return metrics.body.includes('chalkboard_collaboration_active_rooms 0');
    });
    const recovered = new FailureClient(url);
    clients.push(recovered);
    await recovered.opened();
    await waitFor(
      () => recovered.document.getText('value').toString() === 'durable',
    );
    expect(loads).toBe(2);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('chalkboard_storage_failures_total 1');
    expect(metrics.body).toContain(
      'chalkboard_collaboration_pending_persistence_writes 0',
    );
  } finally {
    for (const client of clients) client.close();
    durableDocument.destroy();
    await app.close();
  }
}, 10_000);
