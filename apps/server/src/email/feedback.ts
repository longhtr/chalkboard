/** Idempotently stores minimum provider feedback metadata and applies complaint/hard-bounce suppression. */
import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { rollbackPreservingFailure } from '../db/transactionFailure.js';

export type EmailFeedbackType =
  | 'bounce'
  | 'complaint'
  | 'delivery'
  | 'delivery-delay'
  | 'reject'
  | 'rendering-failure'
  | 'send';

export interface EmailFeedbackEvent {
  bounceType?: 'permanent' | 'transient' | 'undetermined';
  eventType: EmailFeedbackType;
  occurredAt?: Date;
  providerEventId: string;
  providerMessageId: string;
}

export interface EmailFeedbackService {
  process(
    event: EmailFeedbackEvent,
  ): Promise<
    | { outcome: 'duplicate' | 'processed' | 'unmatched' }
    | { outcome: 'suppressed'; reason: 'complaint' | 'hard-bounce' }
  >;
}

function eventDigest(providerEventId: string): string {
  return createHash('sha256').update(providerEventId).digest('hex');
}

/** Stores minimum provider metadata and applies idempotent suppression changes. */
export function createEmailFeedbackService(pool: Pool): EmailFeedbackService {
  return {
    async process(event) {
      if (
        event.providerEventId.length === 0 ||
        event.providerEventId.length > 512 ||
        event.providerMessageId.length === 0 ||
        event.providerMessageId.length > 512 ||
        (event.occurredAt !== undefined &&
          !Number.isFinite(event.occurredAt.getTime()))
      ) {
        throw new Error('Invalid email feedback metadata');
      }
      const digest = eventDigest(event.providerEventId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`chalkboard:email-provider-message:${event.providerMessageId}`],
        );
        const intent = await client.query<{
          destination_digest: string;
          id: string;
          key_generation: number;
        }>(
          `SELECT id, key_generation, destination_digest
           FROM email_send_intents
           WHERE provider_message_id = $1
           FOR UPDATE`,
          [event.providerMessageId],
        );
        const matched = intent.rows[0];
        const suppressionReason =
          event.eventType === 'complaint'
            ? 'complaint'
            : event.eventType === 'bounce' && event.bounceType === 'permanent'
              ? 'hard-bounce'
              : null;
        const inserted = await client.query(
          `INSERT INTO email_feedback_events (
             event_digest, event_type, suppression_reason, send_intent_id,
             provider_message_id, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (event_digest) DO NOTHING`,
          [
            digest,
            event.eventType,
            suppressionReason,
            matched?.id ?? null,
            event.providerMessageId,
            event.occurredAt ?? null,
          ],
        );
        if (inserted.rowCount !== 1) {
          await client.query('COMMIT');
          return { outcome: 'duplicate' };
        }
        // Every newly authenticated complaint stops registration immediately,
        // even when provider acceptance bookkeeping has not yet attached the
        // message identifier to its intent. Destination suppression is
        // reconciled later when that minimum metadata becomes available.
        if (event.eventType === 'complaint') {
          await client.query(
            `UPDATE email_flow_switches
             SET enabled = FALSE, reason = 'complaint-emergency-stop',
                 updated_at = NOW()
             WHERE flow = 'registration'`,
          );
        }
        if (matched === undefined) {
          await client.query('COMMIT');
          return { outcome: 'unmatched' };
        }

        if (suppressionReason !== null) {
          await client.query(
            `INSERT INTO email_suppressions (
               key_generation, destination_digest, reason,
               source_event_digest
             ) VALUES ($1, $2, $3, $4)
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
            [
              matched.key_generation,
              matched.destination_digest,
              suppressionReason,
              digest,
            ],
          );
          await client.query('COMMIT');
          return { outcome: 'suppressed', reason: suppressionReason };
        }
        await client.query('COMMIT');
        return { outcome: 'processed' };
      } catch (error) {
        throw await rollbackPreservingFailure(client, error);
      } finally {
        client.release();
      }
    },
  };
}
