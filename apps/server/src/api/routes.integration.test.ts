/**
 * Exercises account, session, board, membership, invitation, and trash HTTP
 * protocols against PostgreSQL, including independent authorization failures.
 */
import { scryptSync } from 'node:crypto';
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

describe.skipIf(connectionString === undefined)('account and board API', () => {
  const pool = new Pool({ connectionString });
  const email = `api-${crypto.randomUUID()}@example.com`;
  const collaboratorEmail = `collaborator-${crypto.randomUUID()}@example.com`;
  const settingsEmail = `settings-${crypto.randomUUID()}@example.com`;
  const changedSettingsEmail = `changed-${crypto.randomUUID()}@example.com`;
  const legacyEmail = `legacy-${crypto.randomUUID()}@example.com`;
  let app: ReturnType<typeof buildApp>;
  let cookie = '';
  let boardId = '';

  beforeAll(async () => {
    await runMigrations(pool, resolve(process.cwd(), 'migrations'));
    app = buildApp({
      config: loadConfig({ DATABASE_URL: connectionString, NODE_ENV: 'test' }),
      verificationEmailSender: {
        close: () => undefined,
        send: async () => undefined,
        verify: async () => undefined,
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const users = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE email_normalized = ANY($1::text[])',
      [
        [
          email,
          collaboratorEmail,
          settingsEmail,
          changedSettingsEmail,
          legacyEmail,
        ],
      ],
    );
    for (const { id } of users.rows) {
      await pool.query('DELETE FROM boards WHERE owner_id = $1', [id]);
    }
    if (users.rows.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        users.rows.map(({ id }) => id),
      ]);
    }
    await pool.end();
  });

  it('registers, restores a session, and manages board metadata', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: 'Ada', email, password: 'correct horse battery' },
    });
    expect(registration.statusCode).toBe(202);
    expect(registration.json()).toEqual({
      email,
      verificationRequired: true,
    });
    const beforeVerification = await pool.query(
      'SELECT 1 FROM users WHERE email_normalized = $1',
      [email],
    );
    expect(beforeVerification.rowCount).toBe(0);
    const verification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { code: '1234-5678', email },
    });
    expect(verification.statusCode).toBe(201);
    expect(verification.json()).toMatchObject({
      user: { displayName: 'Ada', email },
    });
    cookie = responseCookie(verification.headers['set-cookie']);
    expect(cookie).toMatch(/^chalkboard_session=/);
    const passwordRecord = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email_normalized = $1',
      [email],
    );
    expect(
      requiredTestValue(passwordRecord.rows[0], 'registered password row')
        .password_hash,
    ).toMatch(/^\$argon2id\$/);

    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ user: { displayName: 'Ada' } });

    const created = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: { cookie },
      payload: { title: 'Calculus notes' },
    });
    expect(created.statusCode).toBe(201);
    const board = requiredTestObject(
      created.json().board,
      'created board response',
    );
    boardId = requiredTestString(board.id, 'created board identifier');
    expect(board.role).toBe('owner');

    const malformedBoard = await app.inject({
      method: 'GET',
      url: '/api/boards/not-a-uuid',
      headers: { cookie },
    });
    expect(malformedBoard.statusCode).toBe(400);
    expect(malformedBoard.json()).toEqual({
      error: 'Invalid resource identifier',
    });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/boards/${boardId}`,
      headers: { cookie },
      payload: { title: 'Analysis notes' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      board: { title: 'Analysis notes' },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/boards',
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      boards: [{ id: boardId, title: 'Analysis notes', role: 'owner' }],
    });

    const collaboratorRegistration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        displayName: 'Grace',
        email: collaboratorEmail,
        password: 'another correct password',
      },
    });
    expect(collaboratorRegistration.statusCode).toBe(202);
    const collaboratorVerification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { code: '1234-5678', email: collaboratorEmail },
    });
    const collaboratorCookie = responseCookie(
      collaboratorVerification.headers['set-cookie'],
    );

    const viewerInvite = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/invite-links`,
      headers: { cookie },
      payload: { role: 'viewer' },
    });
    expect(viewerInvite.statusCode).toBe(201);
    const viewerLink = requiredTestObject(
      viewerInvite.json().link,
      'viewer invitation link',
    );
    const viewerToken = requiredTestString(
      viewerInvite.json().token,
      'viewer invitation token',
    );
    expect(viewerLink.role).toBe('viewer');
    expect(viewerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const viewerRedemption = await app.inject({
      method: 'POST',
      url: '/api/board-invites/redeem',
      headers: { cookie: collaboratorCookie },
      payload: { token: viewerToken },
    });
    expect(viewerRedemption.statusCode).toBe(200);
    expect(viewerRedemption.json()).toMatchObject({
      board: { id: boardId, role: 'viewer' },
    });

    const editorInvite = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/invite-links`,
      headers: { cookie },
      payload: { role: 'editor' },
    });
    const editorToken = requiredTestString(
      editorInvite.json().token,
      'editor invitation token',
    );
    const editorRedemption = await app.inject({
      method: 'POST',
      url: '/api/board-invites/redeem',
      headers: { cookie: collaboratorCookie },
      payload: { token: editorToken },
    });
    expect(editorRedemption.json()).toMatchObject({
      board: { id: boardId, role: 'editor' },
    });

    const noDowngrade = await app.inject({
      method: 'POST',
      url: '/api/board-invites/redeem',
      headers: { cookie: collaboratorCookie },
      payload: { token: viewerToken },
    });
    expect(noDowngrade.json()).toMatchObject({ board: { role: 'editor' } });

    const replacementViewerInvite = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/invite-links`,
      headers: { cookie },
      payload: { role: 'viewer' },
    });
    expect(replacementViewerInvite.statusCode).toBe(201);
    const replacementViewerLink = requiredTestObject(
      replacementViewerInvite.json().link,
      'replacement viewer invitation link',
    );
    const replacementViewerLinkId = requiredTestString(
      replacementViewerLink.id,
      'replacement viewer invitation link identifier',
    );
    const replacementViewerToken = requiredTestString(
      replacementViewerInvite.json().token,
      'replacement viewer invitation token',
    );
    const replacedRedemption = await app.inject({
      method: 'POST',
      url: '/api/board-invites/redeem',
      headers: { cookie: collaboratorCookie },
      payload: { token: viewerToken },
    });
    expect(replacedRedemption.statusCode).toBe(404);
    const replacementRedemption = await app.inject({
      method: 'POST',
      url: '/api/board-invites/redeem',
      headers: { cookie: collaboratorCookie },
      payload: { token: replacementViewerToken },
    });
    expect(replacementRedemption.json()).toMatchObject({
      board: { role: 'editor' },
    });

    const unauthorizedInvite = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/invite-links`,
      headers: { cookie: collaboratorCookie },
      payload: { role: 'viewer' },
    });
    expect(unauthorizedInvite.statusCode).toBe(403);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}/invite-links/${replacementViewerLinkId}`,
      headers: { cookie },
    });
    expect(revoked.statusCode).toBe(204);
    const revokedRedemption = await app.inject({
      method: 'POST',
      url: '/api/board-invites/redeem',
      headers: { cookie: collaboratorCookie },
      payload: { token: replacementViewerToken },
    });
    expect(revokedRedemption.statusCode).toBe(404);

    const activeLinks = await app.inject({
      method: 'GET',
      url: `/api/boards/${boardId}/invite-links`,
      headers: { cookie },
    });
    expect(activeLinks.json()).toMatchObject({
      links: [{ role: 'editor' }],
    });

    const added = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/members`,
      headers: { cookie },
      payload: { email: collaboratorEmail, role: 'viewer' },
    });
    expect(added.statusCode).toBe(201);
    const collaboratorId = requiredTestString(
      added.json().member?.userId,
      'added collaborator identifier',
    );

    const sharedBoards = await app.inject({
      method: 'GET',
      url: '/api/boards',
      headers: { cookie: collaboratorCookie },
    });
    expect(sharedBoards.json()).toMatchObject({
      boards: [{ id: boardId, role: 'viewer' }],
    });

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/boards/${boardId}/members/${collaboratorId}`,
      headers: { cookie },
      payload: { role: 'editor' },
    });
    expect(promoted.json()).toMatchObject({ member: { role: 'editor' } });

    const memberRemoved = await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}/members/${collaboratorId}`,
      headers: { cookie },
    });
    expect(memberRemoved.statusCode).toBe(204);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);

    const trashed = await app.inject({
      method: 'GET',
      url: '/api/boards/trash',
      headers: { cookie },
    });
    expect(trashed.json()).toMatchObject({
      boards: [{ id: boardId, title: 'Analysis notes' }],
    });
    const restored = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/restore`,
      headers: { cookie },
    });
    expect(restored.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/boards',
          headers: { cookie },
        })
      ).json(),
    ).toMatchObject({ boards: [{ id: boardId }] });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/boards/${boardId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    const deletedPermanently = await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}/permanent`,
      headers: { cookie },
    });
    expect(deletedPermanently.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/boards/trash',
          headers: { cookie },
        })
      ).json(),
    ).toEqual({ boards: [] });

    const bulkBoardIds = await Promise.all(
      ['Bulk one', 'Bulk two'].map(async (title) => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/boards',
          headers: { cookie },
          payload: { title },
        });
        return requiredTestString(
          response.json().board?.id,
          `created ${title} board identifier`,
        );
      }),
    );
    await Promise.all(
      bulkBoardIds.map((id) =>
        app.inject({
          method: 'DELETE',
          url: `/api/boards/${id}`,
          headers: { cookie },
        }),
      ),
    );
    const restoredAll = await app.inject({
      method: 'POST',
      url: '/api/boards/trash/restore-all',
      headers: { cookie },
    });
    expect(restoredAll.statusCode).toBe(200);
    expect(restoredAll.json()).toEqual({ restored: 2 });
    await Promise.all(
      bulkBoardIds.map((id) =>
        app.inject({
          method: 'DELETE',
          url: `/api/boards/${id}`,
          headers: { cookie },
        }),
      ),
    );
    const emptied = await app.inject({
      method: 'DELETE',
      url: '/api/boards/trash',
      headers: { cookie },
    });
    expect(emptied.statusCode).toBe(200);
    expect(emptied.json()).toEqual({ deleted: 2 });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('rejects duplicate registration and invalid login consistently', async () => {
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        displayName: 'Other',
        email: email.toUpperCase(),
        password: 'another valid password',
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'incorrect password' },
    });
    expect(login.statusCode).toBe(401);

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-email', password: 'short' },
    });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.json()).toEqual(login.json());
  });

  it('verifies registration, email changes, password changes, and password recovery', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        displayName: 'Settings User',
        email: settingsEmail,
        password: 'initial settings password',
      },
    });
    expect(registration.statusCode).toBe(202);
    expect(
      (
        await pool.query('SELECT 1 FROM users WHERE email_normalized = $1', [
          settingsEmail,
        ])
      ).rowCount,
    ).toBe(0);

    const wrongRegistrationCode = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { code: '0000-0000', email: settingsEmail },
    });
    expect(wrongRegistrationCode.statusCode).toBe(400);
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { code: '1234-5678', email: settingsEmail },
    });
    expect(verified.statusCode).toBe(201);
    const settingsCookie = responseCookie(verified.headers['set-cookie']);

    const username = await app.inject({
      method: 'PATCH',
      url: '/api/account/display-name',
      headers: { cookie: settingsCookie },
      payload: { displayName: 'Updated Username' },
    });
    expect(username.statusCode).toBe(200);
    expect(username.json()).toMatchObject({
      user: { displayName: 'Updated Username', email: settingsEmail },
    });

    const wrongEmailPassword = await app.inject({
      method: 'PATCH',
      url: '/api/account/email',
      headers: { cookie: settingsCookie },
      payload: {
        currentPassword: 'incorrect password',
        email: changedSettingsEmail,
      },
    });
    expect(wrongEmailPassword.statusCode).toBe(403);
    const emailChange = await app.inject({
      method: 'PATCH',
      url: '/api/account/email',
      headers: { cookie: settingsCookie },
      payload: {
        currentPassword: 'initial settings password',
        email: changedSettingsEmail,
      },
    });
    expect(emailChange.statusCode).toBe(202);
    const beforeEmailVerification = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: settingsCookie },
    });
    expect(beforeEmailVerification.json()).toMatchObject({
      user: { email: settingsEmail },
    });
    const changedEmail = await app.inject({
      method: 'POST',
      url: '/api/account/email/verify',
      headers: { cookie: settingsCookie },
      payload: { code: '1234-5678' },
    });
    expect(changedEmail.statusCode).toBe(200);
    expect(changedEmail.json()).toMatchObject({
      user: { email: changedSettingsEmail },
    });

    const wrongPasswordChange = await app.inject({
      method: 'PATCH',
      url: '/api/account/password',
      headers: { cookie: settingsCookie },
      payload: {
        currentPassword: 'incorrect password',
        newPassword: 'changed settings password',
      },
    });
    expect(wrongPasswordChange.statusCode).toBe(403);
    const passwordChange = await app.inject({
      method: 'PATCH',
      url: '/api/account/password',
      headers: { cookie: settingsCookie },
      payload: {
        currentPassword: 'initial settings password',
        newPassword: 'changed settings password',
      },
    });
    expect(passwordChange.statusCode).toBe(204);
    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: changedSettingsEmail,
        password: 'initial settings password',
      },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);
    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: changedSettingsEmail,
        password: 'changed settings password',
      },
    });
    expect(newPasswordLogin.statusCode).toBe(200);
    const secondCookie = responseCookie(newPasswordLogin.headers['set-cookie']);

    const unknownReset = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset',
      payload: { email: `unknown-${crypto.randomUUID()}@example.com` },
    });
    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset',
      payload: { email: changedSettingsEmail },
    });
    expect(unknownReset.statusCode).toBe(202);
    expect(reset.statusCode).toBe(202);
    expect(unknownReset.json()).toEqual(reset.json());
    const completedReset = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/complete',
      payload: {
        code: '1234-5678',
        email: changedSettingsEmail,
        newPassword: 'recovered settings password',
      },
    });
    expect(completedReset.statusCode).toBe(204);
    const revokedSession = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: secondCookie },
    });
    expect(revokedSession.statusCode).toBe(401);
    const recoveredLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: changedSettingsEmail,
        password: 'recovered settings password',
      },
    });
    expect(recoveredLogin.statusCode).toBe(200);
  });

  it('migrates a valid legacy scrypt password after login', async () => {
    const salt = Buffer.from('legacy-test-salt');
    const derived = scryptSync('legacy password', salt, 64);
    const legacyHash = `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    await pool.query(
      `INSERT INTO users (email, email_normalized, display_name, password_hash)
       VALUES ($1, $1, 'Legacy User', $2)`,
      [legacyEmail, legacyHash],
    );

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: legacyEmail, password: 'legacy password' },
    });
    expect(login.statusCode).toBe(200);

    const migrated = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email_normalized = $1',
      [legacyEmail],
    );
    expect(
      requiredTestValue(migrated.rows[0], 'migrated password row')
        .password_hash,
    ).toMatch(/^\$argon2id\$/);
  });

  it('rejects cross-site mutation origins', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { host: 'chalkboard.test', origin: 'https://attacker.test' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Request origin not allowed' });
  });

  it('bounds aggregate API mutations by client address', async () => {
    let response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });
    for (
      let attempt = 0;
      attempt < 300 && response.statusCode !== 429;
      attempt += 1
    ) {
      response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    }
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.json()).toEqual({
      error: 'Too many requests. Try again shortly.',
    });
  });
});
