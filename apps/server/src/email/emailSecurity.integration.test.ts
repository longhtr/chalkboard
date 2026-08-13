/** Uses PostgreSQL to prove limiter/capacity races, suppression, feedback idempotency, emergency stop, and cleanup. */
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../db/migrate.js';
import { createEmailSecurityService } from './emailSecurity.js';
import { createEmailFeedbackService } from './feedback.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error(
    'TEST_DATABASE_URL is required for database integration tests',
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const security = createEmailSecurityService(
  pool,
  { generation: 1, value: Buffer.alloc(32, 7) },
  {
    flowSwitchOverrides: {
      'email-change': true,
      'password-reset': true,
      registration: true,
    },
  },
);
const feedback = createEmailFeedbackService(pool);

beforeAll(async () => {
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE email_feedback_events, email_suppressions,
              email_send_intents, email_admission_events RESTART IDENTITY CASCADE`,
  );
  await pool.query(
    `UPDATE email_flow_switches
     SET enabled = TRUE, reason = 'integration-test', updated_at = NOW()`,
  );
});

afterAll(async () => {
  await pool.query(
    `UPDATE email_flow_switches
     SET enabled = FALSE, reason = 'awaiting-account-email-canary', updated_at = NOW()`,
  );
  await pool.end();
});

describe('durable email security', () => {
  it('serializes concurrent destination admission so one minute allows exactly one', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        security.admit({
          destination: 'RACE@EXAMPLE.COM',
          flow: 'registration',
          ip: '2001:db8::1',
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.allowed && result.reason === 'limited',
      ),
    ).toHaveLength(7);
    const stored = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::INTEGER AS count FROM email_admission_events',
    );
    expect(stored.rows[0]?.count).toBe(2);
  });

  it('serializes shared IP admission across distinct destinations', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        security.admit({
          destination: `person-${index}@example.com`,
          flow: 'registration',
          ip: '192.0.2.10',
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(
      results.filter(
        (result) => !result.allowed && result.reason === 'limited',
      ),
    ).toHaveLength(1);
  });

  it('serializes email-change account admission across distinct destinations', async () => {
    const accountId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        security.admit({
          accountId,
          destination: `change-${index}@example.com`,
          flow: 'email-change',
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.allowed && result.reason === 'limited',
      ),
    ).toHaveLength(1);
  });

  it('fails closed before recording admission when a database flow switch is off', async () => {
    await pool.query(
      `UPDATE email_flow_switches
       SET enabled = FALSE, reason = 'integration-stop', updated_at = NOW()`,
    );
    await expect(
      createEmailSecurityService(pool, {
        generation: 1,
        value: Buffer.alloc(32, 7),
      }).admit({
        destination: 'stopped@example.com',
        flow: 'registration',
        ip: '192.0.2.11',
      }),
    ).resolves.toEqual({ allowed: false, reason: 'disabled' });
    const events = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::INTEGER AS count FROM email_admission_events',
    );
    expect(events.rows[0]?.count).toBe(0);
  });

  it('keeps every flow closed across a compromised-key generation change', async () => {
    const accountId = randomUUID();
    await expect(
      security.admit({
        destination: 'registration-before-rotation@example.com',
        flow: 'registration',
        ip: '192.0.2.31',
      }),
    ).resolves.toEqual(expect.objectContaining({ allowed: true }));
    await expect(
      security.admit({
        destination: 'reset-before-rotation@example.com',
        flow: 'password-reset',
        ip: '192.0.2.32',
      }),
    ).resolves.toEqual(expect.objectContaining({ allowed: true }));
    await expect(
      security.admit({
        accountId,
        destination: 'change-before-rotation@example.com',
        flow: 'email-change',
      }),
    ).resolves.toEqual(expect.objectContaining({ allowed: true }));

    await pool.query(
      `UPDATE email_flow_switches
       SET enabled = FALSE, reason = 'admission-key-compromise',
           updated_at = NOW()`,
    );
    const replacement = createEmailSecurityService(pool, {
      generation: 2,
      value: Buffer.alloc(32, 9),
    });
    const attempts = await Promise.all([
      replacement.admit({
        destination: 'registration-after-rotation@example.com',
        flow: 'registration',
        ip: '192.0.2.41',
      }),
      replacement.admit({
        destination: 'reset-after-rotation@example.com',
        flow: 'password-reset',
        ip: '192.0.2.42',
      }),
      replacement.admit({
        accountId,
        destination: 'change-after-rotation@example.com',
        flow: 'email-change',
      }),
    ]);
    expect(attempts).toEqual([
      { allowed: false, reason: 'disabled' },
      { allowed: false, reason: 'disabled' },
      { allowed: false, reason: 'disabled' },
    ]);

    const replacementEvents = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count FROM email_admission_events
       WHERE key_generation = 2`,
    );
    expect(replacementEvents.rows[0]?.count).toBe(0);
    const switches = await pool.query<{
      enabled: boolean;
      flow: string;
      reason: string;
    }>(`SELECT flow, enabled, reason FROM email_flow_switches ORDER BY flow`);
    expect(switches.rows).toEqual([
      {
        enabled: false,
        flow: 'email-change',
        reason: 'admission-key-compromise',
      },
      {
        enabled: false,
        flow: 'password-reset',
        reason: 'admission-key-compromise',
      },
      {
        enabled: false,
        flow: 'registration',
        reason: 'admission-key-compromise',
      },
    ]);
  });

  it('blocks a suppressed normalized destination before recording admission', async () => {
    const digest = security.digestDestination('person@example.com');
    await pool.query(
      `INSERT INTO email_suppressions (
         key_generation, destination_digest, reason
       ) VALUES ($1, $2, 'hard-bounce')`,
      [digest.keyGeneration, digest.value],
    );
    await expect(
      security.admit({
        destination: ' Person@Example.COM ',
        flow: 'registration',
        ip: '192.0.2.1',
      }),
    ).resolves.toEqual({ allowed: false, reason: 'suppressed' });
  });

  it('fails closed at a concurrent-safe hard admission-row ceiling', async () => {
    const bounded = createEmailSecurityService(
      pool,
      { generation: 1, value: Buffer.alloc(32, 8) },
      {
        flowSwitchOverrides: {
          'password-reset': true,
        },
        maximumAdmissionEvents: 2,
      },
    );
    await expect(
      bounded.admit({
        destination: 'first-row-bound@example.com',
        flow: 'password-reset',
        ip: '192.0.2.60',
      }),
    ).resolves.toEqual(expect.objectContaining({ allowed: true }));
    await expect(
      bounded.admit({
        destination: 'second-row-bound@example.com',
        flow: 'password-reset',
        ip: '192.0.2.61',
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'limited',
      retryAfterSeconds: 3_600,
    });
    const stored = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::INTEGER AS count FROM email_admission_events',
    );
    expect(stored.rows[0]?.count).toBe(2);
  });

  it('serializes the global daily cap without an eighty-first accepted intent', async () => {
    const digest = security.digestDestination('capacity@example.com');
    const values = Array.from({ length: 79 }, (_, index) => [
      randomUUID(),
      digest.keyGeneration,
      index.toString(16).padStart(64, '0'),
    ]);
    for (const value of values) {
      await pool.query(
        `INSERT INTO email_send_intents (
           id, key_generation, purpose, destination_digest
         ) VALUES ($1, $2, 'registration', $3)`,
        value,
      );
    }
    const results = await Promise.all([
      security.reserveSend({
        destination: digest,
        purpose: 'registration',
      }),
      security.reserveSend({
        destination: digest,
        purpose: 'registration',
      }),
    ]);
    expect(results.filter((result) => result.reserved)).toHaveLength(1);
    expect(results).toContainEqual(
      expect.objectContaining({ reason: 'capacity', reserved: false }),
    );
    const count = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::INTEGER AS count FROM email_send_intents',
    );
    expect(count.rows[0]?.count).toBe(80);
  });

  it('rejects unbounded provider metadata without resolving its intent', async () => {
    const destination = security.digestDestination('metadata@example.com');
    const reservation = await security.reserveSend({
      destination,
      purpose: 'registration',
    });
    if (!reservation.reserved) throw new Error('Expected send reservation');

    await expect(
      security.completeIntent(reservation.intentId, {
        providerMessageId: 'x'.repeat(513),
        status: 'accepted',
      }),
    ).rejects.toThrow('Invalid provider message metadata');
    const intent = await pool.query<{ status: string }>(
      'SELECT status FROM email_send_intents WHERE id = $1',
      [reservation.intentId],
    );
    expect(intent.rows).toEqual([{ status: 'reserved' }]);
  });

  it('enforces a configured canary below the immutable global hard cap', async () => {
    const canary = createEmailSecurityService(
      pool,
      { generation: 1, value: Buffer.alloc(32, 8) },
      { capacityLimits: { daily: 1, monthly: 2 } },
    );
    const destination = canary.digestDestination('canary@example.com');
    const results = await Promise.all([
      canary.reserveSend({ destination, purpose: 'registration' }),
      canary.reserveSend({ destination, purpose: 'registration' }),
    ]);
    expect(results.filter((result) => result.reserved)).toHaveLength(1);
    expect(results).toContainEqual(
      expect.objectContaining({ reason: 'capacity', reserved: false }),
    );
    expect(() =>
      createEmailSecurityService(
        pool,
        { generation: 1, value: Buffer.alloc(32, 8) },
        { capacityLimits: { daily: 81, monthly: 2_400 } },
      ),
    ).toThrow('hard cap');
  });

  it('makes feedback replay-safe, suppresses hard bounces, and stops registration on complaint', async () => {
    const first = security.digestDestination('bounce@example.com');
    const firstIntent = randomUUID();
    await pool.query(
      `INSERT INTO email_send_intents (
         id, key_generation, purpose, destination_digest, status,
         provider_message_id, resolved_at
       ) VALUES ($1, $2, 'registration', $3, 'accepted', $4, NOW())`,
      [firstIntent, first.keyGeneration, first.value, 'provider-bounce'],
    );
    const hardBounce = {
      bounceType: 'permanent' as const,
      eventType: 'bounce' as const,
      providerEventId: 'sns-event-bounce',
      providerMessageId: 'provider-bounce',
    };
    await expect(feedback.process(hardBounce)).resolves.toEqual({
      outcome: 'suppressed',
      reason: 'hard-bounce',
    });
    await expect(feedback.process(hardBounce)).resolves.toEqual({
      outcome: 'duplicate',
    });
    await expect(
      security.admit({
        destination: 'bounce@example.com',
        flow: 'password-reset',
        ip: '192.0.2.2',
      }),
    ).resolves.toEqual({ allowed: false, reason: 'suppressed' });

    const second = security.digestDestination('complaint@example.com');
    await pool.query(
      `INSERT INTO email_send_intents (
         id, key_generation, purpose, destination_digest, status,
         provider_message_id, resolved_at
       ) VALUES ($1, $2, 'registration', $3, 'accepted', $4, NOW())`,
      [randomUUID(), second.keyGeneration, second.value, 'provider-complaint'],
    );
    await expect(
      feedback.process({
        eventType: 'complaint',
        providerEventId: 'sns-event-complaint',
        providerMessageId: 'provider-complaint',
      }),
    ).resolves.toEqual({ outcome: 'suppressed', reason: 'complaint' });
    const registration = await pool.query<{ enabled: boolean; reason: string }>(
      `SELECT enabled, reason FROM email_flow_switches
       WHERE flow = 'registration'`,
    );
    expect(registration.rows[0]).toEqual({
      enabled: false,
      reason: 'complaint-emergency-stop',
    });
  });

  it('reconciles feedback that arrives before the accepted provider result is recorded', async () => {
    const digest = security.digestDestination('out-of-order@example.com');
    const reservation = await security.reserveSend({
      destination: digest,
      purpose: 'registration',
    });
    if (!reservation.reserved) throw new Error('Expected send reservation');

    await expect(
      feedback.process({
        eventType: 'complaint',
        providerEventId: 'sns-event-before-intent',
        providerMessageId: 'provider-out-of-order',
      }),
    ).resolves.toEqual({ outcome: 'unmatched' });
    const immediateStop = await pool.query<{
      enabled: boolean;
      reason: string;
    }>(
      `SELECT enabled, reason FROM email_flow_switches
       WHERE flow = 'registration'`,
    );
    expect(immediateStop.rows[0]).toEqual({
      enabled: false,
      reason: 'complaint-emergency-stop',
    });

    await security.completeIntent(reservation.intentId, {
      providerMessageId: 'provider-out-of-order',
      status: 'accepted',
    });

    const result = await pool.query<{
      enabled: boolean;
      reason: string;
      send_intent_id: string;
    }>(
      `SELECT switches.enabled, suppressions.reason,
              feedback.send_intent_id
       FROM email_flow_switches AS switches
       CROSS JOIN email_suppressions AS suppressions
       CROSS JOIN email_feedback_events AS feedback
       WHERE switches.flow = 'registration'
         AND suppressions.destination_digest = $1
         AND feedback.provider_message_id = $2`,
      [digest.value, 'provider-out-of-order'],
    );
    expect(result.rows[0]).toEqual({
      enabled: false,
      reason: 'complaint',
      send_intent_id: reservation.intentId,
    });
  });

  it('removes expired and old security metadata in bounded cleanup batches', async () => {
    const digest = security.digestDestination('old@example.com');
    const intentId = randomUUID();
    await pool.query(
      `INSERT INTO email_send_intents (
         id, key_generation, purpose, destination_digest, status,
         provider_message_id, resolved_at, created_at, updated_at
       ) VALUES ($1, $2, 'registration', $3, 'accepted', $4,
                 NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days',
                 NOW() - INTERVAL '31 days')`,
      [intentId, digest.keyGeneration, digest.value, 'provider-old'],
    );
    await pool.query(
      `INSERT INTO email_feedback_events (
         event_digest, event_type, send_intent_id, provider_message_id,
         received_at
       ) VALUES ($1, 'delivery', $2, $3, NOW() - INTERVAL '31 days')`,
      ['b'.repeat(64), intentId, 'provider-old'],
    );
    await pool.query(
      `INSERT INTO email_suppressions (
         key_generation, destination_digest, reason, source_event_digest
       ) VALUES ($1, $2, 'hard-bounce', $3)`,
      [digest.keyGeneration, digest.value, 'b'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO email_send_intents (
         id, key_generation, purpose, destination_digest, status,
         created_at, updated_at
       ) VALUES ($1, $2, 'registration', $3, 'reserved',
                 NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days')`,
      [randomUUID(), digest.keyGeneration, 'c'.repeat(64)],
    );

    await security.cleanup();
    const counts = await pool.query<{
      events: number;
      intents: number;
      source_event_digest: string | null;
      suppressions: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM email_feedback_events) AS events,
         (SELECT COUNT(*)::INTEGER FROM email_send_intents) AS intents,
         (SELECT COUNT(*)::INTEGER FROM email_suppressions) AS suppressions,
         (SELECT source_event_digest FROM email_suppressions LIMIT 1)
           AS source_event_digest`,
    );
    expect(counts.rows[0]).toEqual({
      events: 0,
      intents: 1,
      source_event_digest: null,
      suppressions: 1,
    });
  });
});
