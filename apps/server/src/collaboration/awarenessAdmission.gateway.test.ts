/**
 * Proves Awareness ownership, sanitization, relay, removal, and limits through
 * real WebSocket clients.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  requiredTestValue,
  waitForTestCondition as waitFor,
} from '../test/assertions.js';
import { singleAwarenessUpdate } from './awarenessTestProtocol.js';
import { CollaborationTestClient } from './testClient.js';

const TEST_BOARD_ID = '11111111-1111-4111-8111-111111111111';

describe('collaboration awareness admission', () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  const clients: CollaborationTestClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function openClients(count: number) {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/test' }),
      database: { close: async () => undefined, ping: async () => undefined },
    });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const opened = Array.from(
      { length: count },
      () =>
        new CollaborationTestClient(
          `ws://127.0.0.1:${address.port}/collaboration/${TEST_BOARD_ID}`,
        ),
    );
    clients.push(...opened);
    await Promise.all(opened.map((client) => client.opened()));
    return { app, opened };
  }

  it('rejects awareness client-ID hijacking', async () => {
    const { app, opened } = await openClients(2);
    const first = requiredTestValue(opened[0], 'first collaboration client');
    const second = requiredTestValue(opened[1], 'second collaboration client');
    const messages = second.awarenessMessages;
    first.sendAwareness(singleAwarenessUpdate(7, 1, { cursor: [1, 2] }));
    await waitFor(() => second.awarenessMessages > messages);
    const closed = second.waitForClose();

    second.sendAwareness(singleAwarenessUpdate(7, 2, { cursor: [3, 4] }));
    await expect(closed).resolves.toBe(1008);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain(
      'chalkboard_collaboration_awareness_rejections_total 1',
    );
  });

  it('rejects oversized awareness state before relay', async () => {
    const { app, opened } = await openClients(1);
    const client = requiredTestValue(opened[0], 'collaboration client');
    const closed = client.waitForClose();

    client.sendAwareness(
      singleAwarenessUpdate(8, 1, { selection: 'x'.repeat(70 * 1_024) }),
    );
    await expect(closed).resolves.toBe(1009);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain(
      'chalkboard_collaboration_awareness_rejections_total 1',
    );
  });
});
