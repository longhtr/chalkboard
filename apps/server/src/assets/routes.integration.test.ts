/**
 * Exercises image HTTP routes with PostgreSQL authorization and real admitted
 * bytes, including roles, immutable retrieval, hostile SVG, and media limits.
 */
import { crc32 } from '@chalkboard/shared';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import {
  requiredTestObject,
  requiredTestString,
  requiredTestValue,
  responseCookie,
} from '../test/assertions.js';

const connectionString = process.env.TEST_DATABASE_URL;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
function pngChunk(type: string, payload: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(payload.length + 12);
  result.writeUInt32BE(payload.length);
  typeBytes.copy(result, 4);
  payload.copy(result, 8);
  result.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, payload])),
    result.length - 4,
  );
  return result;
}

const maximumPaddingBytes = 2_500_000 - PNG.length;
const MAXIMUM_PNG = Buffer.concat([
  PNG.subarray(0, -12),
  pngChunk('paDd', Buffer.alloc(maximumPaddingBytes - 12)),
  PNG.subarray(-12),
]);

describe.skipIf(connectionString === undefined)('board asset API', () => {
  const pool = new Pool({ connectionString });
  const emails = ['owner', 'editor', 'viewer', 'outsider'].map(
    (role) => `asset-${role}-${crypto.randomUUID()}@example.com`,
  );
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await runMigrations(pool, resolve(process.cwd(), 'migrations'));
    await pool.query(
      `TRUNCATE email_feedback_events, email_suppressions,
                email_send_intents, email_admission_events RESTART IDENTITY CASCADE`,
    );
    app = buildApp({
      config: loadConfig({ DATABASE_URL: connectionString, NODE_ENV: 'test' }),
      verificationEmailSender: {
        close: () => undefined,
        send: async () => ({ providerMessageId: crypto.randomUUID() }),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const users = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE email_normalized = ANY($1::text[])',
      [emails],
    );
    if (users.rows.length > 0) {
      await pool.query('DELETE FROM boards WHERE owner_id = ANY($1::uuid[])', [
        users.rows.map(({ id }) => id),
      ]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        users.rows.map(({ id }) => id),
      ]);
    }
    await pool.end();
  });

  it('authorizes, validates, deduplicates, serves, and removes assets', async () => {
    const cookies: string[] = [];
    for (const [index, email] of emails.entries()) {
      const registration = await app.inject({
        method: 'POST',
        remoteAddress: `192.0.2.${index + 1}`,
        url: '/api/auth/register',
        payload: {
          displayName: `Asset user ${index}`,
          email,
          password: 'asset test password',
        },
      });
      expect(registration.statusCode).toBe(202);
      const verification = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { code: '1234-5678', email },
      });
      expect(verification.statusCode).toBe(201);
      cookies.push(responseCookie(verification.headers['set-cookie']));
    }
    const ownerCookie = requiredTestValue(cookies[0], 'owner session cookie');
    const editorCookie = requiredTestValue(cookies[1], 'editor session cookie');
    const viewerCookie = requiredTestValue(cookies[2], 'viewer session cookie');
    const outsiderCookie = requiredTestValue(
      cookies[3],
      'outsider session cookie',
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: { cookie: ownerCookie },
      payload: { title: 'Asset board' },
    });
    const boardId = requiredTestString(
      created.json().board?.id,
      'created asset board identifier',
    );
    for (const [email, role] of [
      [requiredTestValue(emails[1], 'editor email'), 'editor'],
      [requiredTestValue(emails[2], 'viewer email'), 'viewer'],
    ] as const) {
      const added = await app.inject({
        method: 'POST',
        url: `/api/boards/${boardId}/members`,
        headers: { cookie: ownerCookie },
        payload: { email, role },
      });
      expect(added.statusCode).toBe(201);
    }

    const unauthenticated = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: { 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const viewerUpload = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: { cookie: viewerCookie, 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(viewerUpload.statusCode).toBe(403);

    const malformed = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: { cookie: editorCookie, 'content-type': 'image/png' },
      payload: Buffer.from('not a png'),
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({
      error: 'The image format or dimensions are invalid',
    });

    const unsafeSvg = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: { cookie: editorCookie, 'content-type': 'image/svg+xml' },
      payload: Buffer.from(
        '<svg width="10" height="10"><script>alert(1)</script></svg>',
      ),
    });
    expect(unsafeSvg.statusCode).toBe(400);
    expect(unsafeSvg.json()).toEqual({
      error: 'The SVG contains unsafe content',
    });

    const oversized = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: { cookie: editorCookie, 'content-type': 'image/png' },
      payload: Buffer.alloc(2_500_001),
    });
    expect(oversized.statusCode).toBe(413);

    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: {
        cookie: editorCookie,
        'content-type': 'image/png',
        'x-file-name': encodeURIComponent('Café ../pixel.png'),
      },
      payload: MAXIMUM_PNG,
    });
    expect(uploaded.statusCode).toBe(201);
    const uploadedAsset = requiredTestObject(
      uploaded.json().asset,
      'uploaded asset response',
    );
    const asset = {
      ...uploadedAsset,
      id: requiredTestString(uploadedAsset.id, 'uploaded asset identifier'),
      url: requiredTestString(uploadedAsset.url, 'uploaded asset URL'),
    };
    expect(asset).toMatchObject({
      byteSize: 2_500_000,
      height: 1,
      mediaType: 'image/png',
      name: 'Café .. pixel.png',
      width: 1,
    });
    expect(asset.url).toBe(`/api/boards/${boardId}/assets/${asset.id}`);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/assets`,
      headers: { cookie: ownerCookie, 'content-type': 'image/png' },
      payload: MAXIMUM_PNG,
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().asset.id).toBe(asset.id);

    for (const cookie of [ownerCookie, editorCookie, viewerCookie]) {
      const downloaded = await app.inject({
        method: 'GET',
        url: asset.url,
        headers: { cookie },
      });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers['content-type']).toBe('image/png');
      expect(downloaded.headers['cache-control']).toBe('private, no-store');
      expect(downloaded.rawPayload.equals(MAXIMUM_PNG)).toBe(true);
    }
    const concealed = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { cookie: outsiderCookie },
    });
    expect(concealed.statusCode).toBe(404);

    await app.close();
    app = buildApp({
      config: loadConfig({
        DATABASE_URL: connectionString,
        NODE_ENV: 'test',
      }),
    });
    await app.ready();
    const afterRestart = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { cookie: viewerCookie },
    });
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.rawPayload.equals(MAXIMUM_PNG)).toBe(true);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}`,
      headers: { cookie: ownerCookie },
    });
    expect(removed.statusCode).toBe(204);
    const retained = await pool.query(
      'SELECT id FROM board_assets WHERE board_id = $1',
      [boardId],
    );
    expect(retained.rowCount).toBe(1);
    const afterRemoval = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { cookie: viewerCookie },
    });
    expect(afterRemoval.statusCode).toBe(404);

    const restored = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/restore`,
      headers: { cookie: ownerCookie },
    });
    expect(restored.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: asset.url,
          headers: { cookie: viewerCookie },
        })
      ).statusCode,
    ).toBe(200);

    await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}`,
      headers: { cookie: ownerCookie },
    });
    const deletedPermanently = await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}/permanent`,
      headers: { cookie: ownerCookie },
    });
    expect(deletedPermanently.statusCode).toBe(204);
    expect(
      (
        await pool.query('SELECT id FROM board_assets WHERE board_id = $1', [
          boardId,
        ])
      ).rowCount,
    ).toBe(0);
  }, 30_000);
});
