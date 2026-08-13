/**
 * Drives complete WebSocket rooms to each frame, queue, document, room, and
 * process admission limit and verifies rejection leaves accepted state intact.
 */
import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_AWARENESS,
  COLLABORATION_MESSAGE_SYNC,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type ClientOptions } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  requiredTestValue,
  waitForTestCondition as waitFor,
} from '../test/assertions.js';

const TEST_BOARD_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_TEST_BOARD_ID = '22222222-2222-4222-8222-222222222222';

class TestClient {
  readonly acknowledgements: number[] = [];
  readonly awareness: awarenessProtocol.Awareness;
  readonly document = new Y.Doc();
  readonly socket: WebSocket;

  constructor(url: string, options?: ClientOptions) {
    this.awareness = new awarenessProtocol.Awareness(this.document);
    this.socket = new WebSocket(url, options);
    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.send(encoding.toUint8Array(encoder));
    });
    this.awareness.on(
      'update',
      (
        changes: { added: number[]; removed: number[]; updated: number[] },
        origin: unknown,
      ) => {
        if (
          origin === this.socket ||
          this.socket.readyState !== WebSocket.OPEN
        ) {
          return;
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
            ...changes.added,
            ...changes.updated,
            ...changes.removed,
          ]),
        );
        this.socket.send(encoding.toUint8Array(encoder));
      },
    );
    this.socket.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data as Buffer));
      const type = decoding.readVarUint(decoder);
      if (type === COLLABORATION_MESSAGE_SYNC) {
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
      } else if (type === COLLABORATION_MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this.socket,
        );
      } else if (type === COLLABORATION_MESSAGE_ACKNOWLEDGEMENT) {
        this.acknowledgements.push(decoding.readVarUint(decoder));
      }
    });
  }

  requestSync(): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.document);
    this.socket.send(encoding.toUint8Array(encoder));
  }

  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  close(): void {
    this.socket.close();
    this.awareness.destroy();
    this.document.destroy();
  }
}

async function listen(app: ReturnType<typeof buildApp>): Promise<number> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Missing server address');
  }
  return address.port;
}

describe('collaboration admission', () => {
  const clients: TestClient[] = [];
  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  it('rejects a room update before applying it when persistence admission is full', async () => {
    let finishFirstAppend: (() => void) | undefined;
    let markFirstAppendStarted: (() => void) | undefined;
    const firstAppendGate = new Promise<void>((resolve) => {
      finishFirstAppend = resolve;
    });
    const firstAppendStarted = new Promise<void>((resolve) => {
      markFirstAppendStarted = resolve;
    });
    const appendedUpdates: Uint8Array[] = [];
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_PENDING_PROCESS_UPDATE_LIMIT: '10',
        YJS_PENDING_ROOM_UPDATE_LIMIT: '2',
        YJS_PENDING_UPDATE_MAX_AGE_MS: '5000',
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async (_boardId, update) => {
            appendedUpdates.push(new Uint8Array(update));
            if (appendedUpdates.length === 1) {
              markFirstAppendStarted?.();
              await firstAppendGate;
            }
            return appendedUpdates.length;
          },
          compact: async () => undefined,
          loadRoom: async () => ({
            snapshot: null,
            snapshotSequence: 0,
            updates: [],
          }),
        },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const url = `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`;
    const writer = new TestClient(url);
    const observer = new TestClient(url);
    clients.push(writer, observer);
    await Promise.all([writer.opened(), observer.opened()]);
    const writerClosed = new Promise<number>((resolve) =>
      writer.socket.once('close', resolve),
    );

    const text = writer.document.getText('value');
    text.insert(0, 'a');
    await firstAppendStarted;
    text.insert(1, 'b');
    await waitFor(() => observer.document.getText('value').toString() === 'ab');
    const pendingMetrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(pendingMetrics.body).toContain(
      'chalkboard_collaboration_pending_persistence_writes 2',
    );

    text.insert(2, 'c');
    await expect(writerClosed).resolves.toBe(1013);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observer.document.getText('value').toString()).toBe('ab');
    expect(appendedUpdates).toHaveLength(1);

    finishFirstAppend?.();
    await waitFor(() => appendedUpdates.length === 2);
    const drainedMetrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(drainedMetrics.body).toContain(
      'chalkboard_collaboration_pending_persistence_writes 0',
    );
    expect(drainedMetrics.body).toContain(
      'chalkboard_collaboration_persistence_overloads_total 1',
    );

    for (const connected of clients.splice(0)) connected.close();
    await app.close();
  });

  it('shares aggregate persistence admission across rooms', async () => {
    let finishAppend: (() => void) | undefined;
    let markAppendStarted: (() => void) | undefined;
    const appendGate = new Promise<void>((resolve) => {
      finishAppend = resolve;
    });
    const appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    let appendedUpdates = 0;
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_PENDING_PROCESS_UPDATE_LIMIT: '1',
        YJS_PENDING_ROOM_UPDATE_LIMIT: '2',
        YJS_PENDING_UPDATE_MAX_AGE_MS: '5000',
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            appendedUpdates += 1;
            if (appendedUpdates === 1) {
              markAppendStarted?.();
              await appendGate;
            }
            return appendedUpdates;
          },
          compact: async () => undefined,
          loadRoom: async () => ({
            snapshot: null,
            snapshotSequence: 0,
            updates: [],
          }),
        },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const first = new TestClient(
      `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`,
    );
    const second = new TestClient(
      `ws://127.0.0.1:${address.port}/collaboration/${SECOND_TEST_BOARD_ID}`,
    );
    clients.push(first, second);
    await Promise.all([first.opened(), second.opened()]);
    const secondClosed = new Promise<number>((resolve) =>
      second.socket.once('close', resolve),
    );

    first.document.getText('value').insert(0, 'accepted');
    await appendStarted;
    second.document.getText('value').insert(0, 'retry');
    await expect(secondClosed).resolves.toBe(1013);
    expect(appendedUpdates).toBe(1);

    finishAppend?.();
    await waitFor(() => first.acknowledgements.length === 1);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain(
      'chalkboard_collaboration_pending_persistence_writes 0',
    );
    for (const connected of clients.splice(0)) connected.close();
    await app.close();
  });

  it('closes a room whose oldest persistence write exceeds its age limit', async () => {
    let finishAppend: (() => void) | undefined;
    let markAppendStarted: (() => void) | undefined;
    const appendGate = new Promise<void>((resolve) => {
      finishAppend = resolve;
    });
    const appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_PENDING_UPDATE_MAX_AGE_MS: '30',
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            markAppendStarted?.();
            await appendGate;
            return 1;
          },
          compact: async () => undefined,
          loadRoom: async () => ({
            snapshot: null,
            snapshotSequence: 0,
            updates: [],
          }),
        },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const client = new TestClient(
      `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`,
    );
    clients.push(client);
    await client.opened();
    const closed = new Promise<number>((resolve) =>
      client.socket.once('close', resolve),
    );

    client.document.getText('value').insert(0, 'stalled');
    await appendStarted;
    await expect(closed).resolves.toBe(1013);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain(
      'chalkboard_collaboration_persistence_overloads_total 1',
    );

    finishAppend?.();
    for (const connected of clients.splice(0)) connected.close();
    await app.close();
  });

  it('rejects an oversized update before applying or relaying it', async () => {
    let appendedUpdates = 0;
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_MAX_UPDATE_BYTES: '64',
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            appendedUpdates += 1;
            return appendedUpdates;
          },
          compact: async () => undefined,
          loadRoom: async () => ({
            snapshot: null,
            snapshotSequence: 0,
            updates: [],
          }),
        },
        ping: async () => undefined,
      },
    });
    const port = await listen(app);
    const url = `ws://127.0.0.1:${port}/collaboration/${TEST_BOARD_ID}`;
    const writer = new TestClient(url);
    const observer = new TestClient(url);
    clients.push(writer, observer);
    await Promise.all([writer.opened(), observer.opened()]);
    const closed = new Promise<number>((resolve) =>
      writer.socket.once('close', resolve),
    );

    writer.document.getText('value').insert(0, 'x'.repeat(256));
    await expect(closed).resolves.toBe(1009);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observer.document.getText('value').toString()).toBe('');
    expect(appendedUpdates).toBe(0);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain(
      'chalkboard_collaboration_document_limit_rejections_total 1',
    );

    for (const connected of clients.splice(0)) connected.close();
    await app.close();
  });

  it('rejects an update before relay when the persisted uncompacted tail exhausts the document quota', async () => {
    const persisted = new Y.Doc();
    const storedText = persisted.getText('value');
    storedText.insert(0, 'x'.repeat(512));
    const storedUpdates = [Y.encodeStateAsUpdate(persisted)];
    storedText.insert(512, 'z');
    storedUpdates.push(Y.encodeStateAsUpdate(persisted));
    const initialText = storedText.toString();
    const persistedBytes = storedUpdates.reduce(
      (total, update) => total + update.byteLength,
      0,
    );
    const encodedBytes = Y.encodeStateAsUpdate(persisted).byteLength;
    const documentBytes = persistedBytes + 16;
    expect(encodedBytes + 256).toBeLessThan(documentBytes);

    let appendedUpdates = 0;
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_MAX_DOCUMENT_BYTES: String(documentBytes),
        YJS_MAX_LOADED_BYTES: String(persistedBytes + 2_048),
        YJS_MAX_UPDATE_BYTES: '1000',
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            appendedUpdates += 1;
            return appendedUpdates;
          },
          compact: async () => undefined,
          loadRoom: async () => ({
            snapshot: null,
            snapshotSequence: 0,
            updates: storedUpdates.map((update, index) => ({
              sequence: index + 1,
              update,
            })),
          }),
        },
        ping: async () => undefined,
      },
    });
    const port = await listen(app);
    const url = `ws://127.0.0.1:${port}/collaboration/${TEST_BOARD_ID}`;
    const writer = new TestClient(url);
    const observer = new TestClient(url);
    clients.push(writer, observer);
    await Promise.all([writer.opened(), observer.opened()]);
    writer.requestSync();
    observer.requestSync();
    await waitFor(
      () =>
        writer.document.getText('value').toString() === initialText &&
        observer.document.getText('value').toString() === initialText,
    );
    const closed = new Promise<number>((resolve) =>
      writer.socket.once('close', resolve),
    );

    writer.document
      .getText('value')
      .insert(initialText.length, 'y'.repeat(128));
    await expect(closed).resolves.toBe(1009);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observer.document.getText('value').toString()).toBe(initialText);
    expect(appendedUpdates).toBe(0);

    for (const connected of clients.splice(0)) connected.close();
    await app.close();
    persisted.destroy();
  });

  it('rejects an oversized stored room before Yjs reconstruction', async () => {
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_MAX_DOCUMENT_BYTES: '100',
        YJS_MAX_LOADED_BYTES: '200',
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => 1,
          compact: async () => undefined,
          loadRoom: async () => ({
            snapshot: new Uint8Array(201),
            snapshotSequence: 1,
            updates: [],
          }),
        },
        ping: async () => undefined,
      },
    });
    const port = await listen(app);
    const client = new TestClient(
      `ws://127.0.0.1:${port}/collaboration/${TEST_BOARD_ID}`,
    );
    clients.push(client);
    const closed = new Promise<number>((resolve) =>
      client.socket.once('close', resolve),
    );
    await client.opened();
    await expect(closed).resolves.toBe(1011);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain(
      'chalkboard_collaboration_document_limit_rejections_total 1',
    );

    for (const connected of clients.splice(0)) connected.close();
    await app.close();
  });

  it('bounds concurrent and pending compactions across rooms', async () => {
    let finishFirstCompaction: (() => void) | undefined;
    let markFirstCompactionStarted: (() => void) | undefined;
    const firstCompactionGate = new Promise<void>((resolve) => {
      finishFirstCompaction = resolve;
    });
    const firstCompactionStarted = new Promise<void>((resolve) => {
      markFirstCompactionStarted = resolve;
    });
    let sequence = 0;
    const compactedBoards: string[] = [];
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_COMPACTION_UPDATE_THRESHOLD: '1',
        YJS_MAX_CONCURRENT_COMPACTIONS: '1',
        YJS_MAX_LOADED_UPDATES: '1',
        YJS_PENDING_COMPACTION_LIMIT: '1',
        YJS_PENDING_ROOM_UPDATE_LIMIT: '1',
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            sequence += 1;
            return sequence;
          },
          compact: async (boardId) => {
            compactedBoards.push(boardId);
            if (compactedBoards.length === 1) {
              markFirstCompactionStarted?.();
              await firstCompactionGate;
            }
          },
          loadRoom: async () => ({
            snapshot: null,
            snapshotSequence: 0,
            updates: [],
          }),
        },
        ping: async () => undefined,
      },
    });
    const port = await listen(app);
    const boardIds = [
      TEST_BOARD_ID,
      SECOND_TEST_BOARD_ID,
      '33333333-3333-4333-8333-333333333333',
    ];
    const connected = boardIds.map(
      (boardId) =>
        new TestClient(`ws://127.0.0.1:${port}/collaboration/${boardId}`),
    );
    clients.push(...connected);
    await Promise.all(connected.map((client) => client.opened()));

    const first = requiredTestValue(
      connected[0],
      'first connected room client',
    );
    const second = requiredTestValue(
      connected[1],
      'second connected room client',
    );
    const third = requiredTestValue(
      connected[2],
      'third connected room client',
    );
    first.document.getText('value').insert(0, 'a');
    await firstCompactionStarted;
    second.document.getText('value').insert(0, 'b');
    await waitFor(() => second.acknowledgements.length === 1);
    const thirdClosed = new Promise<number>((resolve) =>
      third.socket.once('close', resolve),
    );
    third.document.getText('value').insert(0, 'c');
    await waitFor(() => third.acknowledgements.length === 1);
    await expect(thirdClosed).resolves.toBe(1013);

    const saturated = await app.inject({ method: 'GET', url: '/metrics' });
    expect(saturated.body).toContain(
      'chalkboard_collaboration_active_compactions 1',
    );
    expect(saturated.body).toContain(
      'chalkboard_collaboration_pending_compactions 1',
    );
    expect(saturated.body).toContain(
      'chalkboard_collaboration_compaction_overloads_total 1',
    );

    finishFirstCompaction?.();
    await waitFor(() => compactedBoards.length === 2);
    for (const client of clients.splice(0)) client.close();
    await app.close();
  });
});
