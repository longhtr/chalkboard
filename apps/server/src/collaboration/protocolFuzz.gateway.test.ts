/** Uses deterministic malformed binary frames to prove protocol errors remain bounded and room-local. */
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { CollaborationTestClient } from './testClient.js';

const BOARD_ID = '22222222-2222-4222-8222-222222222222';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sourceAddress(index: number): string {
  return `127.1.0.${index + 1}`;
}

describe('collaboration protocol fuzz boundary', () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  const clients: CollaborationTestClient[] = [];

  afterEach(async () => {
    await Promise.all(
      clients.splice(0).map((client) => client.close().catch(() => undefined)),
    );
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('isolates deterministic malformed frames and remains usable', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgresql://unused/fuzz' }),
      database: { close: async () => undefined, ping: async () => undefined },
    });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const url = `ws://127.0.0.1:${address.port}/collaboration/${BOARD_ID}`;
    const curated = [
      new Uint8Array(),
      new Uint8Array([0]),
      new Uint8Array([0, 0]),
      new Uint8Array([0, 1]),
      new Uint8Array([0, 2]),
      new Uint8Array([1]),
      new Uint8Array([1, 1, 0x80]),
    ];
    let state = 0x9e37_79b9;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const frames = [...curated];
    for (let index = curated.length; index < 64; index += 1) {
      const frame = new Uint8Array(random() % 129);
      for (let offset = 0; offset < frame.length; offset += 1) {
        frame[offset] = random() & 0xff;
      }
      frames.push(frame);
    }

    let policyCloses = 0;
    for (const [index, frame] of frames.entries()) {
      const client = new CollaborationTestClient(url, {
        localAddress: sourceAddress(index),
      });
      clients.push(client);
      await client.opened();
      const closed = client.waitForClose();
      client.sendRaw(frame);
      const code = await Promise.race([closed, delay(75).then(() => null)]);
      if (code === null) {
        await client.close();
      } else {
        expect([1003, 1008, 1009, 1013]).toContain(code);
        policyCloses += 1;
        client.destroy();
      }
      clients.pop();
    }
    expect(policyCloses).toBeGreaterThanOrEqual(curated.length);

    const valid = new CollaborationTestClient(
      `ws://127.0.0.1:${address.port}/collaboration/33333333-3333-4333-8333-333333333333`,
      { localAddress: '127.1.1.1' },
    );
    clients.push(valid);
    await valid.opened();
    valid.insert('|valid-after-fuzz|');
    const deadline = Date.now() + 5_000;
    while (valid.acknowledgementSequences.length === 0) {
      if (Date.now() > deadline)
        throw new Error('Valid update was not durable');
      await delay(10);
    }
    expect(valid.text()).toBe('|valid-after-fuzz|');
    const health = await app.inject({ method: 'GET', url: '/health/live' });
    expect(health.statusCode).toBe(200);
  });
});
