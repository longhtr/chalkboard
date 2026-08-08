/**
 * End-to-end WebSocket protocol examples for upgrade authorization, Yjs sync,
 * viewer restrictions, presence, durable acknowledgements, and room retirement.
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
import { MAX_COLLABORATION_CONNECTIONS_PER_SESSION } from './gateway.js';
import {
  MAX_COLLABORATION_MESSAGES_PER_WINDOW,
  MAX_QUEUED_COLLABORATION_MESSAGES,
} from './hub.js';

const TEST_BOARD_ID = '11111111-1111-4111-8111-111111111111';

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

describe('collaboration gateway', () => {
  const clients: TestClient[] = [];
  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  it('rejects collaboration upgrades without a session', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaborationAuthorization: { authorize: async () => 'editor' },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`,
    );
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).rejects.toThrow('Unexpected server response: 401');
    await app.close();
  });

  it('rejects malformed board identifiers before authorization', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaborationAuthorization: { authorize: async () => 'editor' },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/collaboration/not-a-uuid`,
      { headers: { Cookie: 'chalkboard_session=editor' } },
    );
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).rejects.toThrow('Unexpected server response: 400');
    await app.close();
  });

  it('bounds concurrent collaboration connections per session', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaborationAuthorization: { authorize: async () => 'editor' },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const url = `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`;
    const sockets: WebSocket[] = [];
    try {
      for (
        let index = 0;
        index < MAX_COLLABORATION_CONNECTIONS_PER_SESSION;
        index += 1
      ) {
        const socket = new WebSocket(url, {
          headers: { Cookie: 'chalkboard_session=bounded-session' },
        });
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
        });
      }
      const rejected = new WebSocket(url, {
        headers: { Cookie: 'chalkboard_session=bounded-session' },
      });
      await expect(
        new Promise<void>((resolve, reject) => {
          rejected.once('open', resolve);
          rejected.once('error', reject);
        }),
      ).rejects.toThrow('Unexpected server response: 429');
    } finally {
      for (const socket of sockets) socket.close();
      await app.close();
    }
  });

  it('rejects cross-site collaboration upgrades even with a valid session', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaborationAuthorization: { authorize: async () => 'editor' },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`,
      {
        headers: {
          Cookie: 'chalkboard_session=editor',
          Origin: 'https://attacker.test',
        },
      },
    );
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).rejects.toThrow('Unexpected server response: 403');
    await app.close();
  });

  it('rejects new upgrades while drain waits for queued persistence', async () => {
    let finishAppend: (() => void) | undefined;
    let markAppendStarted: (() => void) | undefined;
    const appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            markAppendStarted?.();
            await new Promise<void>((resolve) => {
              finishAppend = resolve;
            });
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
    const url = `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`;
    const client = new TestClient(url);
    clients.push(client);
    await client.opened();
    client.document.getText('value').insert(0, 'queued');
    await appendStarted;

    app.beginDrain();
    const rejected = new WebSocket(url);
    await expect(
      new Promise<void>((resolve, reject) => {
        rejected.once('open', resolve);
        rejected.once('error', reject);
      }),
    ).rejects.toThrow('Unexpected server response: 503');

    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(closed).toBe(false);
    finishAppend?.();
    await closing;
    clients.splice(clients.indexOf(client), 1);
    client.close();
  });

  it('does not load a replacement room until final persistence completes', async () => {
    let finishAppend: (() => void) | undefined;
    let finishCompaction: (() => void) | undefined;
    let markAppendStarted: (() => void) | undefined;
    let markCompactionStarted: (() => void) | undefined;
    const appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    const appendGate = new Promise<void>((resolve) => {
      finishAppend = resolve;
    });
    const compactionStarted = new Promise<void>((resolve) => {
      markCompactionStarted = resolve;
    });
    const compactionGate = new Promise<void>((resolve) => {
      finishCompaction = resolve;
    });
    let loadCount = 0;
    let sequence = 0;
    let snapshot: Uint8Array | null = null;
    let snapshotSequence = 0;
    let updates: { sequence: number; update: Uint8Array }[] = [];
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async (_boardId, update) => {
            markAppendStarted?.();
            await appendGate;
            sequence += 1;
            updates.push({ sequence, update: new Uint8Array(update) });
            return sequence;
          },
          compact: async (_boardId, nextSnapshot, throughSequence) => {
            markCompactionStarted?.();
            await compactionGate;
            snapshot = new Uint8Array(nextSnapshot);
            snapshotSequence = throughSequence;
            updates = updates.filter(
              (entry) => entry.sequence > throughSequence,
            );
          },
          loadRoom: async () => {
            loadCount += 1;
            return {
              snapshot,
              snapshotSequence,
              updates: updates.map((entry) => ({
                sequence: entry.sequence,
                update: new Uint8Array(entry.update),
              })),
            };
          },
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
    const first = new TestClient(url);
    clients.push(first);
    await first.opened();
    first.document.getText('value').insert(0, 'persisted before reconnect');
    await appendStarted;

    const firstClosed = new Promise<void>((resolve) =>
      first.socket.once('close', () => resolve()),
    );
    first.socket.close();
    await firstClosed;
    const second = new TestClient(url);
    clients.push(second);
    await second.opened();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loadCount).toBe(1);

    finishAppend?.();
    await compactionStarted;
    expect(loadCount).toBe(1);
    finishCompaction?.();
    await waitFor(() => loadCount === 2);
    second.requestSync();
    await waitFor(
      () =>
        second.document.getText('value').toString() ===
        'persisted before reconnect',
    );

    for (const client of clients.splice(0)) client.close();
    await app.close();
  }, 15_000);

  it('retires a room when its only socket closes during loading', async () => {
    let finishFirstLoad: (() => void) | undefined;
    const firstLoadGate = new Promise<void>((resolve) => {
      finishFirstLoad = resolve;
    });
    let loadCount = 0;
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => 1,
          compact: async () => undefined,
          loadRoom: async () => {
            loadCount += 1;
            if (loadCount === 1) await firstLoadGate;
            return { snapshot: null, snapshotSequence: 0, updates: [] };
          },
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
    const abandoned = new TestClient(url);
    clients.push(abandoned);
    await abandoned.opened();
    const abandonedClosed = new Promise<void>((resolve) =>
      abandoned.socket.once('close', () => resolve()),
    );
    abandoned.socket.close();
    await abandonedClosed;
    finishFirstLoad?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const replacement = new TestClient(url);
    clients.push(replacement);
    await replacement.opened();
    await waitFor(() => loadCount === 2);

    for (const client of clients.splice(0)) client.close();
    await app.close();
  });

  it('bounds messages queued while a collaboration room loads', async () => {
    let finishLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => 1,
          compact: async () => undefined,
          loadRoom: async () => {
            await loadGate;
            return { snapshot: null, snapshotSequence: 0, updates: [] };
          },
        },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const closed = new Promise<number>((resolve) =>
      socket.once('close', resolve),
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, new Y.Doc());
    const syncRequest = encoding.toUint8Array(encoder);
    for (
      let index = 0;
      index <= MAX_QUEUED_COLLABORATION_MESSAGES;
      index += 1
    ) {
      socket.send(syncRequest);
    }
    await expect(closed).resolves.toBe(1008);
    finishLoad?.();
    await app.close();
  });

  it('rejects text frames and collaboration message floods', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaborationAuthorization: { authorize: async () => 'editor' },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const url = `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`;
    const options = { headers: { Cookie: 'chalkboard_session=editor' } };

    const textSocket = new WebSocket(url, options);
    await new Promise<void>((resolve, reject) => {
      textSocket.once('open', resolve);
      textSocket.once('error', reject);
    });
    const textClosed = new Promise<number>((resolve) =>
      textSocket.once('close', resolve),
    );
    textSocket.send('not binary');
    await expect(textClosed).resolves.toBe(1003);

    const floodSocket = new WebSocket(url, options);
    await new Promise<void>((resolve, reject) => {
      floodSocket.once('open', resolve);
      floodSocket.once('error', reject);
    });
    const floodClosed = new Promise<number>((resolve) =>
      floodSocket.once('close', resolve),
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, new Y.Doc());
    const syncRequest = encoding.toUint8Array(encoder);
    for (
      let index = 0;
      index <= MAX_COLLABORATION_MESSAGES_PER_WINDOW;
      index += 1
    ) {
      floodSocket.send(syncRequest);
    }
    await expect(floodClosed).resolves.toBe(1008);

    await app.close();
  });

  it('allows viewers to receive updates and awareness but rejects edits', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaborationAuthorization: {
          authorize: async (_boardId, token) =>
            token === 'editor'
              ? 'editor'
              : token === 'viewer'
                ? 'viewer'
                : null,
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
    const editor = new TestClient(url, {
      headers: { Cookie: 'chalkboard_session=editor' },
    });
    clients.push(editor);
    await editor.opened();
    editor.document.getText('value').insert(0, 'shared');

    const viewer = new TestClient(url, {
      headers: { Cookie: 'chalkboard_session=viewer' },
    });
    clients.push(viewer);
    await viewer.opened();
    await waitFor(
      () => viewer.document.getText('value').toString() === 'shared',
    );
    viewer.awareness.setLocalStateField('user', { name: 'Viewer' });
    await waitFor(() =>
      [...editor.awareness.getStates().values()].some(
        (state) => state.user?.name === 'Viewer',
      ),
    );

    const closed = new Promise<number>((resolve) =>
      viewer.socket.once('close', resolve),
    );
    viewer.document.getText('value').insert(6, ' forbidden');
    await expect(closed).resolves.toBe(1008);
    expect(editor.document.getText('value').toString()).toBe('shared');

    for (const client of clients.splice(0)) client.close();
    await app.close();
  });

  it('revokes an active editor immediately when board access changes', async () => {
    let appendedUpdates = 0;
    let role: 'editor' | 'viewer' = 'editor';
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
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
        collaborationAuthorization: {
          authorize: async () => role,
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
    const editor = new TestClient(url, {
      headers: { Cookie: 'chalkboard_session=editor-session' },
    });
    clients.push(editor);
    await editor.opened();
    const editorClosed = new Promise<number>((resolve) =>
      editor.socket.once('close', resolve),
    );

    role = 'viewer';
    app.invalidateCollaborationBoard(TEST_BOARD_ID);
    editor.document.getText('value').insert(0, 'too late');
    await expect(editorClosed).resolves.toBe(1008);
    expect(appendedUpdates).toBe(0);

    const reconnectedViewer = new TestClient(url, {
      headers: { Cookie: 'chalkboard_session=editor-session' },
    });
    clients.push(reconnectedViewer);
    await reconnectedViewer.opened();
    const viewerClosed = new Promise<number>((resolve) =>
      reconnectedViewer.socket.once('close', resolve),
    );
    reconnectedViewer.document.getText('value').insert(0, 'forbidden');
    await expect(viewerClosed).resolves.toBe(1008);

    for (const client of clients.splice(0)) client.close();
    await app.close();
  });

  it('closes every socket authenticated by a revoked session', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaborationAuthorization: { authorize: async () => 'editor' },
        ping: async () => undefined,
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const sessionToken = 'active-session';
    const client = new TestClient(
      `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`,
      { headers: { Cookie: `chalkboard_session=${sessionToken}` } },
    );
    clients.push(client);
    await client.opened();
    const closed = new Promise<number>((resolve) =>
      client.socket.once('close', resolve),
    );

    app.invalidateCollaborationSession(sessionToken);
    await expect(closed).resolves.toBe(1008);

    for (const connected of clients.splice(0)) connected.close();
    await app.close();
  });

  it('acknowledges an update only after durable persistence completes', async () => {
    let resolveAppend: ((sequence: number) => void) | undefined;
    let markAppendStarted: (() => void) | undefined;
    const appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            markAppendStarted?.();
            return await new Promise<number>((resolve) => {
              resolveAppend = resolve;
            });
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
    client.document.getText('value').insert(0, 'durable');
    await appendStarted;
    expect(client.acknowledgements).toEqual([]);
    resolveAppend?.(41);
    await waitFor(() => client.acknowledgements.length === 1);
    expect(client.acknowledgements).toEqual([41]);

    for (const connected of clients.splice(0)) connected.close();
    await app.close();
  });

  it('compacts a bounded update tail while clients remain connected', async () => {
    const compactionUpdateThreshold = 3;
    let sequence = 0;
    const compactions: { sequence: number; snapshot: Uint8Array }[] = [];
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/test',
        YJS_COMPACTION_UPDATE_THRESHOLD: String(compactionUpdateThreshold),
      }),
      database: {
        close: async () => undefined,
        collaboration: {
          appendUpdate: async () => {
            sequence += 1;
            return sequence;
          },
          compact: async (_boardId, snapshot, throughSequence) => {
            compactions.push({
              sequence: throughSequence,
              snapshot: new Uint8Array(snapshot),
            });
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
    const text = client.document.getText('value');
    for (let update = 0; update < compactionUpdateThreshold; update += 1) {
      text.insert(text.length, 'x');
    }

    await waitFor(
      () => client.acknowledgements.length === compactionUpdateThreshold,
    );
    await waitFor(() => compactions.length === 1);
    expect(
      requiredTestValue(compactions[0], 'threshold compaction').sequence,
    ).toBe(compactionUpdateThreshold);
    const compacted = new Y.Doc();
    Y.applyUpdate(
      compacted,
      requiredTestValue(compactions[0], 'threshold compaction').snapshot,
    );
    expect(compacted.getText('value').toString()).toBe(
      'x'.repeat(compactionUpdateThreshold),
    );
    compacted.destroy();
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    text.insert(text.length, 'y');
    await waitFor(
      () => client.acknowledgements.length === compactionUpdateThreshold + 1,
    );
    expect(compactions).toHaveLength(1);

    for (const connected of clients.splice(0)) connected.close();
    await app.close();
    expect(compactions).toHaveLength(2);
    const final = new Y.Doc();
    Y.applyUpdate(
      final,
      requiredTestValue(compactions[1], 'retirement compaction').snapshot,
    );
    expect(final.getText('value').toString()).toBe(
      `${'x'.repeat(compactionUpdateThreshold)}y`,
    );
    final.destroy();
  });

  it('converges document and awareness updates between two clients', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: { close: async () => undefined, ping: async () => undefined },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const url = `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`;
    const first = new TestClient(url);
    const second = new TestClient(url);
    clients.push(first, second);
    await Promise.all([first.opened(), second.opened()]);

    first.document.getText('value').insert(0, 'from first');
    await waitFor(
      () => second.document.getText('value').toString() === 'from first',
    );
    second.document.getText('value').insert(10, ' + second');
    await waitFor(
      () =>
        first.document.getText('value').toString() ===
        second.document.getText('value').toString(),
    );

    first.awareness.setLocalStateField('user', { name: 'Ada' });
    await waitFor(() =>
      [...second.awareness.getStates().values()].some(
        (state) => state.user?.name === 'Ada',
      ),
    );
    expect(first.document.getText('value').toString()).toBe(
      'from first + second',
    );

    const firstClientId = first.awareness.clientID;
    first.close();
    clients.splice(clients.indexOf(first), 1);
    await waitFor(() => !second.awareness.getStates().has(firstClientId));

    for (const client of clients.splice(0)) client.close();
    await app.close();
  });
});
