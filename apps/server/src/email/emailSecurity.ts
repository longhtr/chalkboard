/** PostgreSQL-backed email admission, capacity, suppression, intent, switch, and cleanup authority. */
import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import type { Pool, PoolClient } from 'pg';

import { rollbackPreservingFailure } from '../db/transactionFailure.js';

export type EmailFlow = 'email-change' | 'password-reset' | 'registration';
export type EmailFailureClass =
  | 'configuration'
  | 'destination'
  | 'provider-rejection'
  | 'transport'
  | 'unknown';

export interface EmailDigest {
  keyGeneration: number;
  value: string;
}

export type EmailAdmissionResult =
  | { allowed: true; destination: EmailDigest }
  | {
      allowed: false;
      reason: 'disabled' | 'limited' | 'suppressed';
      retryAfterSeconds?: number;
    };

export type EmailSendReservation =
  | { reserved: true; intentId: string }
  | {
      reserved: false;
      reason: 'capacity' | 'suppressed';
      retryAfterSeconds?: number;
    };

export interface EmailSecurityService {
  admit(input: {
    accountId?: string;
    destination: string;
    flow: EmailFlow;
    ip?: string;
  }): Promise<EmailAdmissionResult>;
  cleanup(): Promise<void>;
  completeIntent(
    intentId: string,
    outcome:
      | { status: 'accepted'; providerMessageId: string }
      | { status: 'ambiguous'; failureClass: EmailFailureClass }
      | { status: 'not-needed' }
      | { status: 'rejected'; failureClass: EmailFailureClass },
  ): Promise<void>;
  digestDestination(destination: string): EmailDigest;
  reserveSend(input: {
    accountId?: string;
    destination: EmailDigest;
    purpose: EmailFlow;
  }): Promise<EmailSendReservation>;
  switchStatus(): Promise<Record<EmailFlow, boolean>>;
}

interface EmailSecurityKey {
  generation: number;
  value: Buffer;
}

interface Limit {
  count: number;
  milliseconds: number;
  scope: 'account' | 'destination' | 'ip';
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const MAX_EMAIL_ADMISSION_EVENTS = 10_000;

const FLOW_LIMITS: Record<EmailFlow, readonly Limit[]> = {
  registration: [
    { count: 15, milliseconds: HOUR_MS, scope: 'ip' },
    { count: 40, milliseconds: DAY_MS, scope: 'ip' },
    { count: 1, milliseconds: MINUTE_MS, scope: 'destination' },
    { count: 3, milliseconds: HOUR_MS, scope: 'destination' },
    { count: 5, milliseconds: DAY_MS, scope: 'destination' },
  ],
  'password-reset': [
    { count: 15, milliseconds: HOUR_MS, scope: 'ip' },
    { count: 40, milliseconds: DAY_MS, scope: 'ip' },
    { count: 1, milliseconds: MINUTE_MS, scope: 'destination' },
    { count: 3, milliseconds: HOUR_MS, scope: 'destination' },
    { count: 5, milliseconds: DAY_MS, scope: 'destination' },
  ],
  'email-change': [
    { count: 1, milliseconds: MINUTE_MS, scope: 'account' },
    { count: 3, milliseconds: DAY_MS, scope: 'account' },
    { count: 1, milliseconds: MINUTE_MS, scope: 'destination' },
    { count: 3, milliseconds: DAY_MS, scope: 'destination' },
  ],
};

function normalizeDestination(destination: string): string {
  return destination.trim().toLocaleLowerCase('en-US');
}

/** Normalizes textual client addresses so equivalent forms share one limiter. */
export function canonicalClientIp(input: string): string {
  const value = input.trim().toLocaleLowerCase('en-US');
  if (isIP(value) === 0) throw new Error('Invalid client address');
  if (isIP(value) === 4) return value;

  // URL's IPv6 parser applies RFC compression and converts embedded dotted
  // quads. Collapse IPv4-mapped addresses back to IPv4 so the same client cannot
  // obtain separate counters through the two textual families.
  const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(canonical);
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1] ?? '', 16);
    const low = Number.parseInt(mapped[2] ?? '', 16);
    return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
  }
  return canonical;
}

function hmac(
  key: EmailSecurityKey,
  namespace: string,
  value: string,
): EmailDigest {
  return {
    keyGeneration: key.generation,
    value: createHmac('sha256', key.value)
      .update(namespace)
      .update('\0')
      .update(value)
      .digest('hex'),
  };
}

async function lock(
  client: PoolClient,
  names: readonly string[],
): Promise<void> {
  for (const name of [...new Set(names)].sort()) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [name],
    );
  }
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK');
}

/** PostgreSQL authority for durable abuse admission and provider-send capacity. */
export function startEmailSecurityMaintenance(options: {
  intervalMilliseconds?: number;
  onError(error: unknown): void;
  service: EmailSecurityService;
}): () => void {
  const intervalMilliseconds = options.intervalMilliseconds ?? 60 * 60 * 1000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const run = async () => {
    try {
      await options.service.cleanup();
    } catch (error) {
      options.onError(error);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void run(), intervalMilliseconds);
        timer.unref();
      }
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}

export function createEmailSecurityService(
  pool: Pool,
  key: EmailSecurityKey,
  options: {
    capacityLimits?: { daily: number; monthly: number };
    flowSwitchOverrides?: Partial<Record<EmailFlow, boolean>>;
    maximumAdmissionEvents?: number;
    testLimitMultiplier?: number;
  } = {},
): EmailSecurityService {
  if (!Number.isInteger(key.generation) || key.generation < 1) {
    throw new Error('Email security key generation must be positive');
  }
  if (key.value.byteLength < 32) {
    throw new Error('Email security key must contain at least 32 bytes');
  }
  const dailyCapacity = options.capacityLimits?.daily ?? 100;
  const monthlyCapacity = options.capacityLimits?.monthly ?? 3_000;
  const maximumAdmissionEvents =
    options.maximumAdmissionEvents ?? MAX_EMAIL_ADMISSION_EVENTS;
  const testLimitMultiplier = options.testLimitMultiplier ?? 1;
  if (
    !Number.isInteger(maximumAdmissionEvents) ||
    maximumAdmissionEvents < 2 ||
    maximumAdmissionEvents > MAX_EMAIL_ADMISSION_EVENTS
  ) {
    throw new Error('Invalid email admission storage limit');
  }
  if (
    !Number.isInteger(testLimitMultiplier) ||
    testLimitMultiplier < 1 ||
    testLimitMultiplier > 100
  ) {
    throw new Error('Invalid test-only email admission multiplier');
  }
  if (
    !Number.isInteger(dailyCapacity) ||
    dailyCapacity < 1 ||
    dailyCapacity > 100 ||
    !Number.isInteger(monthlyCapacity) ||
    monthlyCapacity < dailyCapacity ||
    monthlyCapacity > 3_000
  ) {
    throw new Error('Email capacity limits exceed the application hard cap');
  }

  const digestDestination = (destination: string) =>
    hmac(key, 'destination', normalizeDestination(destination));

  return {
    async admit(input) {
      const destination = digestDestination(input.destination);
      const subjects = new Map<Limit['scope'], EmailDigest>();
      subjects.set('destination', destination);
      if (input.ip !== undefined) {
        subjects.set('ip', hmac(key, 'ip', canonicalClientIp(input.ip)));
      }
      if (input.accountId !== undefined) {
        subjects.set('account', hmac(key, 'account', input.accountId));
      }
      const limits = FLOW_LIMITS[input.flow].map((limit) => ({
        ...limit,
        count: limit.count * testLimitMultiplier,
      }));
      if (limits.some(({ scope }) => !subjects.has(scope))) {
        throw new Error(`Missing ${input.flow} admission subject`);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await lock(client, [
          'chalkboard:email-admission-global',
          ...limits.map(({ scope }) => {
            const subject = subjects.get(scope);
            if (subject === undefined)
              throw new Error('Missing admission subject');
            return `chalkboard:email-admission:${key.generation}:${input.flow}:${scope}:${subject.value}`;
          }),
        ]);
        const flowSwitch = await client.query<{ enabled: boolean }>(
          `SELECT enabled FROM email_flow_switches WHERE flow = $1 FOR SHARE`,
          [input.flow],
        );
        const flowEnabled =
          options.flowSwitchOverrides?.[input.flow] ??
          flowSwitch.rows[0]?.enabled ??
          false;
        if (!flowEnabled) {
          await rollback(client);
          return { allowed: false, reason: 'disabled' };
        }
        const suppressed = await client.query(
          `SELECT 1 FROM email_suppressions
           WHERE key_generation = $1 AND destination_digest = $2`,
          [destination.keyGeneration, destination.value],
        );
        if ((suppressed.rowCount ?? 0) > 0) {
          await rollback(client);
          return { allowed: false, reason: 'suppressed' };
        }

        let retryAfterSeconds = 0;
        for (const limit of limits) {
          const subject = subjects.get(limit.scope);
          if (subject === undefined)
            throw new Error('Missing admission subject');
          const result = await client.query<{
            attempt_count: number;
            first_attempt: Date | null;
          }>(
            `SELECT COUNT(*)::INTEGER AS attempt_count,
                    MIN(occurred_at) AS first_attempt
             FROM email_admission_events
             WHERE key_generation = $1 AND flow = $2 AND scope = $3
               AND subject_digest = $4
               AND occurred_at > NOW() - ($5 * INTERVAL '1 millisecond')`,
            [
              key.generation,
              input.flow,
              limit.scope,
              subject.value,
              limit.milliseconds,
            ],
          );
          const row = result.rows[0];
          if (row !== undefined && row.attempt_count >= limit.count) {
            const elapsed =
              row.first_attempt === null
                ? 0
                : Date.now() - row.first_attempt.getTime();
            retryAfterSeconds = Math.max(
              retryAfterSeconds,
              Math.ceil((limit.milliseconds - elapsed) / 1_000),
            );
          }
        }
        if (retryAfterSeconds > 0) {
          await rollback(client);
          return {
            allowed: false,
            reason: 'limited',
            retryAfterSeconds: Math.max(1, retryAfterSeconds),
          };
        }

        const admittedScopes = new Set(limits.map(({ scope }) => scope));
        const storedEvents = await client.query<{ event_count: number }>(
          `SELECT COUNT(*)::INTEGER AS event_count
           FROM email_admission_events`,
        );
        const storedEventCount = storedEvents.rows[0]?.event_count;
        if (
          storedEventCount === undefined ||
          storedEventCount + admittedScopes.size > maximumAdmissionEvents
        ) {
          await rollback(client);
          return {
            allowed: false,
            reason: 'limited',
            retryAfterSeconds: 3_600,
          };
        }

        for (const scope of admittedScopes) {
          const subject = subjects.get(scope);
          if (subject === undefined)
            throw new Error('Missing admission subject');
          await client.query(
            `INSERT INTO email_admission_events (
               key_generation, flow, scope, subject_digest, expires_at
             ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')`,
            [key.generation, input.flow, scope, subject.value],
          );
        }
        await client.query('COMMIT');
        return { allowed: true, destination };
      } catch (error) {
        throw await rollbackPreservingFailure(client, error);
      } finally {
        client.release();
      }
    },

    async cleanup() {
      const statements = [
        `DELETE FROM pending_registrations WHERE ctid IN (
           SELECT ctid FROM pending_registrations
           WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 250
         )`,
        `DELETE FROM pending_email_changes WHERE ctid IN (
           SELECT ctid FROM pending_email_changes
           WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 250
         )`,
        `DELETE FROM pending_password_resets WHERE ctid IN (
           SELECT ctid FROM pending_password_resets
           WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 250
         )`,
        `DELETE FROM sessions WHERE ctid IN (
           SELECT ctid FROM sessions
           WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 500
         )`,
        `DELETE FROM email_admission_events WHERE ctid IN (
           SELECT ctid FROM email_admission_events
           WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 1000
         )`,
        `DELETE FROM email_feedback_events WHERE ctid IN (
           SELECT ctid FROM email_feedback_events
           WHERE received_at < NOW() - INTERVAL '30 days'
           ORDER BY received_at LIMIT 500
         )`,
        `DELETE FROM email_send_intents WHERE ctid IN (
           SELECT ctid FROM email_send_intents
           WHERE created_at < NOW() - INTERVAL '30 days'
           ORDER BY created_at LIMIT 500
         )`,
      ];
      for (const statement of statements) await pool.query(statement);
    },

    async completeIntent(intentId, outcome) {
      if (
        outcome.status === 'accepted' &&
        (outcome.providerMessageId.length === 0 ||
          outcome.providerMessageId.length > 512)
      ) {
        throw new Error('Invalid provider message metadata');
      }
      const status = outcome.status;
      const resolved =
        status === 'accepted' ||
        status === 'rejected' ||
        status === 'not-needed';
      const providerMessageId =
        status === 'accepted' ? outcome.providerMessageId : null;
      const failureClass =
        status === 'ambiguous' || status === 'rejected'
          ? outcome.failureClass
          : null;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (providerMessageId !== null) {
          await lock(client, [
            `chalkboard:email-provider-message:${providerMessageId}`,
          ]);
        }
        const result = await client.query(
          `UPDATE email_send_intents
           SET status = $2, provider_message_id = $3, failure_class = $4,
               resolved_at = CASE WHEN $5 THEN NOW() ELSE NULL END,
               updated_at = NOW()
           WHERE id = $1 AND status = 'reserved'`,
          [intentId, status, providerMessageId, failureClass, resolved],
        );
        if (result.rowCount !== 1) {
          throw new Error('Email send intent is not reserved');
        }
        if (providerMessageId !== null) {
          await client.query(
            `UPDATE email_feedback_events
             SET send_intent_id = $2
             WHERE provider_message_id = $1 AND send_intent_id IS NULL`,
            [providerMessageId, intentId],
          );
          await client.query(
            `INSERT INTO email_suppressions (
               key_generation, destination_digest, reason,
               source_event_digest
             )
             SELECT intent.key_generation, intent.destination_digest,
                    feedback.suppression_reason, feedback.event_digest
             FROM email_send_intents AS intent
             CROSS JOIN LATERAL (
               SELECT suppression_reason, event_digest
               FROM email_feedback_events
               WHERE provider_message_id = $2
                 AND suppression_reason IS NOT NULL
               ORDER BY
                 CASE WHEN suppression_reason = 'complaint' THEN 0 ELSE 1 END,
                 received_at
               LIMIT 1
             ) AS feedback
             WHERE intent.id = $1
             ON CONFLICT (key_generation, destination_digest) DO UPDATE SET
               reason = CASE
                 WHEN email_suppressions.reason = 'complaint'
                   THEN email_suppressions.reason
                 ELSE EXCLUDED.reason
               END,
               source_event_digest = CASE
                 WHEN email_suppressions.reason = 'complaint'
                   THEN email_suppressions.source_event_digest
                 ELSE EXCLUDED.source_event_digest
               END,
               updated_at = NOW()`,
            [intentId, providerMessageId],
          );
          await client.query(
            `UPDATE email_flow_switches
             SET enabled = FALSE, reason = 'complaint-emergency-stop',
                 updated_at = NOW()
             WHERE flow = 'registration'
               AND EXISTS (
                 SELECT 1 FROM email_feedback_events
                 WHERE provider_message_id = $1
                   AND suppression_reason = 'complaint'
               )`,
            [providerMessageId],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        throw await rollbackPreservingFailure(client, error);
      } finally {
        client.release();
      }
    },

    digestDestination,

    async reserveSend(input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await lock(client, ['chalkboard:email-global-capacity']);
        const suppressed = await client.query(
          `SELECT 1 FROM email_suppressions
           WHERE key_generation = $1 AND destination_digest = $2`,
          [input.destination.keyGeneration, input.destination.value],
        );
        if ((suppressed.rowCount ?? 0) > 0) {
          await rollback(client);
          return { reserved: false, reason: 'suppressed' };
        }
        const capacity = await client.query<{
          daily: number;
          monthly: number;
        }>(
          `SELECT
             COUNT(*) FILTER (
               WHERE created_at > NOW() - ($1 * INTERVAL '1 millisecond')
             )::INTEGER AS daily,
             COUNT(*) FILTER (
               WHERE created_at > NOW() - ($2 * INTERVAL '1 millisecond')
             )::INTEGER AS monthly
           FROM email_send_intents`,
          [DAY_MS, MONTH_MS],
        );
        const row = capacity.rows[0];
        if (row === undefined) throw new Error('Email capacity query failed');
        if (row.daily >= dailyCapacity || row.monthly >= monthlyCapacity) {
          await rollback(client);
          return {
            reserved: false,
            reason: 'capacity',
            retryAfterSeconds: row.daily >= dailyCapacity ? 3_600 : 86_400,
          };
        }
        const intentId = randomUUID();
        await client.query(
          `INSERT INTO email_send_intents (
             id, key_generation, purpose, destination_digest, user_id
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            intentId,
            input.destination.keyGeneration,
            input.purpose,
            input.destination.value,
            input.accountId ?? null,
          ],
        );
        await client.query('COMMIT');
        return { reserved: true, intentId };
      } catch (error) {
        throw await rollbackPreservingFailure(client, error);
      } finally {
        client.release();
      }
    },

    async switchStatus() {
      const result = await pool.query<{ enabled: boolean; flow: EmailFlow }>(
        `SELECT flow, enabled FROM email_flow_switches ORDER BY flow`,
      );
      const status: Record<EmailFlow, boolean> = {
        'email-change': false,
        'password-reset': false,
        registration: false,
      };
      for (const row of result.rows) {
        status[row.flow] =
          options.flowSwitchOverrides?.[row.flow] ?? row.enabled;
      }
      return status;
    },
  };
}
