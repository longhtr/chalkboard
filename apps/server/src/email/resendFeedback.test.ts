/** Covers Svix signature verification, replay bounds, and minimum Resend parsing. */
import { createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createResendWebhookVerifier,
  parseResendFeedbackDetailed,
  ResendFeedbackBoundaryError,
  type ResendWebhookHeaders,
} from './resendFeedback.js';

const secretBytes = randomBytes(32);
const signingSecret = `whsec_${secretBytes.toString('base64')}`;
const messageId = 'msg_2abcDEF';
const nowSeconds = 1_760_000_000;
const now = () => new Date(nowSeconds * 1_000);

function sign(id: string, timestampSeconds: number, body: string): string {
  const digest = createHmac('sha256', secretBytes)
    .update(`${id}.${timestampSeconds}.${body}`, 'utf8')
    .digest('base64');
  return `v1,${digest}`;
}

function deliveredBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    created_at: '2026-08-21T10:00:00.000Z',
    data: {
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      from: 'Chalkboard <accounts@chalkboard.space>',
      subject: 'Confirm your Chalkboard account',
      to: ['someone@example.com'],
    },
    type: 'email.delivered',
    ...overrides,
  });
}

function headersFor(
  body: string,
  overrides: ResendWebhookHeaders = {},
): ResendWebhookHeaders {
  return {
    'svix-id': messageId,
    'svix-signature': sign(messageId, nowSeconds, body),
    'svix-timestamp': String(nowSeconds),
    ...overrides,
  };
}

const verifier = createResendWebhookVerifier({ now, signingSecret });

describe('createResendWebhookVerifier', () => {
  it('accepts a correctly signed webhook and returns the signed identifiers', () => {
    const body = deliveredBody();
    const message = verifier.verify({ body, headers: headersFor(body) });
    expect(message.id).toBe(messageId);
    expect(message.timestampSeconds).toBe(nowSeconds);
    expect(message.payload).toMatchObject({ type: 'email.delivered' });
  });

  it('accepts a secret supplied without the whsec_ prefix', () => {
    const bare = createResendWebhookVerifier({
      now,
      signingSecret: secretBytes.toString('base64'),
    });
    const body = deliveredBody();
    expect(bare.verify({ body, headers: headersFor(body) }).id).toBe(messageId);
  });

  it('accepts the correct signature among several offered versions', () => {
    const body = deliveredBody();
    const headers = headersFor(body, {
      'svix-signature': `v2,${randomBytes(32).toString('base64')} ${sign(
        messageId,
        nowSeconds,
        body,
      )}`,
    });
    expect(verifier.verify({ body, headers }).id).toBe(messageId);
  });

  it('rejects a body altered after signing', () => {
    const body = deliveredBody();
    const headers = headersFor(body);
    const tampered = deliveredBody({ type: 'email.bounced' });
    expect(() => verifier.verify({ body: tampered, headers })).toThrow(
      ResendFeedbackBoundaryError,
    );
  });

  it('rejects a signature computed over a different message identifier', () => {
    const body = deliveredBody();
    const headers = headersFor(body, {
      'svix-signature': sign('msg_other', nowSeconds, body),
    });
    expect(() => verifier.verify({ body, headers })).toThrow(
      /Resend feedback boundary failed: signature/u,
    );
  });

  it('rejects a signature computed under a different secret', () => {
    const other = randomBytes(32);
    const body = deliveredBody();
    const digest = createHmac('sha256', other)
      .update(`${messageId}.${nowSeconds}.${body}`, 'utf8')
      .digest('base64');
    const headers = headersFor(body, { 'svix-signature': `v1,${digest}` });
    expect(() => verifier.verify({ body, headers })).toThrow(/signature/u);
  });

  it('rejects a replayed webhook outside the tolerance window', () => {
    const staleSeconds = nowSeconds - 301;
    const body = deliveredBody();
    const headers = {
      'svix-id': messageId,
      'svix-signature': sign(messageId, staleSeconds, body),
      'svix-timestamp': String(staleSeconds),
    };
    try {
      verifier.verify({ body, headers });
      expect.unreachable('stale webhook was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(ResendFeedbackBoundaryError);
      const diagnostic = (error as ResendFeedbackBoundaryError).diagnostic();
      expect(diagnostic.reason).toBe('timestamp');
      expect(diagnostic.timestampSkewSeconds).toBe(301);
      expect(diagnostic.retryable).toBe(false);
    }
  });

  it('accepts a webhook at the edge of the tolerance window', () => {
    const edgeSeconds = nowSeconds - 300;
    const body = deliveredBody();
    const headers = {
      'svix-id': messageId,
      'svix-signature': sign(messageId, edgeSeconds, body),
      'svix-timestamp': String(edgeSeconds),
    };
    expect(verifier.verify({ body, headers }).timestampSeconds).toBe(
      edgeSeconds,
    );
  });

  it('rejects a timestamp too far in the future', () => {
    const futureSeconds = nowSeconds + 301;
    const body = deliveredBody();
    const headers = {
      'svix-id': messageId,
      'svix-signature': sign(messageId, futureSeconds, body),
      'svix-timestamp': String(futureSeconds),
    };
    expect(() => verifier.verify({ body, headers })).toThrow(/timestamp/u);
  });

  it.each([
    ['svix-id', 'header-shape'],
    ['svix-signature', 'header-shape'],
    ['svix-timestamp', 'header-shape'],
  ])('rejects a webhook missing %s', (header, reason) => {
    const body = deliveredBody();
    const headers = headersFor(body);
    delete headers[header];
    try {
      verifier.verify({ body, headers });
      expect.unreachable('missing signed header was accepted');
    } catch (error) {
      expect((error as ResendFeedbackBoundaryError).reason).toBe(reason);
    }
  });

  it('rejects a repeated signed header as ambiguous', () => {
    const body = deliveredBody();
    const headers = headersFor(body, { 'svix-id': [messageId, 'msg_other'] });
    try {
      verifier.verify({ body, headers });
      expect.unreachable('repeated header was accepted');
    } catch (error) {
      const diagnostic = (error as ResendFeedbackBoundaryError).diagnostic();
      expect(diagnostic.reason).toBe('header-shape');
      expect(diagnostic.headerShape.idRepeated).toBe(true);
    }
  });

  it.each([
    ['an empty message identifier', ''],
    ['an oversized message identifier', 'm'.repeat(513)],
    ['an identifier with unsafe characters', 'msg\n injected'],
  ])('rejects %s before verifying anything', (_label, value) => {
    const body = deliveredBody();
    const headers = headersFor(body, {
      'svix-id': value,
      'svix-signature': sign(value, nowSeconds, body),
    });
    try {
      verifier.verify({ body, headers });
      expect.unreachable('unusable message identifier was accepted');
    } catch (error) {
      expect((error as ResendFeedbackBoundaryError).reason).toBe(
        'header-shape',
      );
    }
  });

  it('rejects an empty signature header', () => {
    const body = deliveredBody();
    const headers = headersFor(body, { 'svix-signature': '' });
    try {
      verifier.verify({ body, headers });
      expect.unreachable('empty signature was accepted');
    } catch (error) {
      expect((error as ResendFeedbackBoundaryError).reason).toBe(
        'header-shape',
      );
    }
  });

  it('rejects an already parsed body, which cannot preserve signed bytes', () => {
    const body = deliveredBody();
    const headers = headersFor(body);
    try {
      verifier.verify({ body: JSON.parse(body), headers });
      expect.unreachable('parsed body was accepted');
    } catch (error) {
      expect((error as ResendFeedbackBoundaryError).reason).toBe('body');
    }
  });

  it('rejects a non-numeric timestamp without attempting verification', () => {
    const body = deliveredBody();
    const headers = headersFor(body, { 'svix-timestamp': 'not-a-number' });
    expect(() => verifier.verify({ body, headers })).toThrow(/timestamp/u);
  });

  it('rejects a signature of the wrong length', () => {
    const body = deliveredBody();
    const headers = headersFor(body, {
      'svix-signature': `v1,${randomBytes(16).toString('base64')}`,
    });
    try {
      verifier.verify({ body, headers });
      expect.unreachable('short signature was accepted');
    } catch (error) {
      const diagnostic = (error as ResendFeedbackBoundaryError).diagnostic();
      expect(diagnostic.reason).toBe('signature');
      expect(diagnostic.signatureEntriesMalformed).toBe(1);
    }
  });

  it('rejects an unusable signing secret when the verifier is created', () => {
    expect(() =>
      createResendWebhookVerifier({ signingSecret: 'whsec_not base64!' }),
    ).toThrow(/signing-secret/u);
    expect(() =>
      createResendWebhookVerifier({
        signingSecret: `whsec_${randomBytes(8).toString('base64')}`,
      }),
    ).toThrow(/signing-secret/u);
  });

  it('rejects a verified body that is not JSON', () => {
    const body = 'not json';
    const headers = headersFor(body);
    try {
      verifier.verify({ body, headers });
      expect.unreachable('unparseable body was accepted');
    } catch (error) {
      expect((error as ResendFeedbackBoundaryError).reason).toBe('body');
    }
  });

  it('rejects an empty body', () => {
    const headers = headersFor('');
    expect(() => verifier.verify({ body: '', headers })).toThrow(/body/u);
  });

  it('never claims complete coverage of a body it only partly inspected', () => {
    const oversized = 'x'.repeat(70 * 1_024);
    const headers = headersFor(oversized);
    try {
      verifier.verify({ body: oversized, headers });
      expect.unreachable('oversized body was accepted');
    } catch (error) {
      const diagnostic = (error as ResendFeedbackBoundaryError).diagnostic();
      expect(diagnostic.reason).toBe('body');
      const body = diagnostic.bodyDiagnostic;
      expect(body?.observedByteLength).toBe(70 * 1_024);
      expect(body?.fingerprintCoversCompleteValue).toBe(true);
      expect(body?.summaryOmittedAsPrivate).toBe(true);
      expect(JSON.stringify(diagnostic)).not.toContain('xxxxxxxxxx');
    }
  });
});

describe('parseResendFeedbackDetailed', () => {
  const verify = (body: string) =>
    verifier.verify({ body, headers: headersFor(body) });

  it('reduces a delivery to provider identifiers and discards recipient data', () => {
    const { event } = parseResendFeedbackDetailed(verify(deliveredBody()));
    expect(event).toEqual({
      eventType: 'delivery',
      occurredAt: new Date('2026-08-21T10:00:00.000Z'),
      providerEventId: messageId,
      providerMessageId: '56761188-7520-42d8-8898-ff6fc54ce618',
    });
    expect(JSON.stringify(event)).not.toContain('someone@example.com');
    expect(JSON.stringify(event)).not.toContain('Confirm your');
  });

  it('uses the provider message identifier from the delivery event', () => {
    const { event } = parseResendFeedbackDetailed(verify(deliveredBody()));
    expect(event?.providerMessageId).toBe(
      '56761188-7520-42d8-8898-ff6fc54ce618',
    );
  });

  it('carries the Svix identifier as the deduplication key', () => {
    const { event } = parseResendFeedbackDetailed(verify(deliveredBody()));
    expect(event?.providerEventId).toBe(messageId);
  });

  it.each([
    ['email.sent', 'send'],
    ['email.delivered', 'delivery'],
    ['email.delivery_delayed', 'delivery-delay'],
    ['email.complained', 'complaint'],
    ['email.failed', 'reject'],
  ])('maps %s to %s', (type, expected) => {
    const { event } = parseResendFeedbackDetailed(
      verify(deliveredBody({ type })),
    );
    expect(event?.eventType).toBe(expected);
  });

  it.each([
    ['Permanent', 'permanent'],
    ['Temporary', 'transient'],
    ['Transient', 'transient'],
    ['something-new', 'undetermined'],
  ])('classifies a %s bounce as %s', (providerType, expected) => {
    const body = JSON.stringify({
      created_at: '2026-08-21T10:00:00.000Z',
      data: {
        bounce: { subType: 'Suppressed', type: providerType },
        email_id: 'abc',
      },
      type: 'email.bounced',
    });
    const { event } = parseResendFeedbackDetailed(verify(body));
    expect(event?.eventType).toBe('bounce');
    expect(event?.bounceType).toBe(expected);
  });

  it('treats a bounce with no stated type as undetermined, never permanent', () => {
    const body = JSON.stringify({
      created_at: '2026-08-21T10:00:00.000Z',
      data: { email_id: 'abc' },
      type: 'email.bounced',
    });
    const { event } = parseResendFeedbackDetailed(verify(body));
    expect(event?.bounceType).toBe('undetermined');
  });

  it('ignores tracking events rather than storing them', () => {
    for (const type of ['email.opened', 'email.clicked', 'contact.created']) {
      const result = parseResendFeedbackDetailed(
        verify(deliveredBody({ type })),
      );
      expect(result.event).toBeNull();
      expect(result.diagnostic.ignoredReason).toBe('unsupported-event-type');
      expect(result.diagnostic.eventType).toBe(type);
    }
  });

  it('omits an unparseable timestamp instead of storing an invalid date', () => {
    const { event } = parseResendFeedbackDetailed(
      verify(deliveredBody({ created_at: 'not-a-date' })),
    );
    expect(event).not.toHaveProperty('occurredAt');
  });

  it('rejects a payload with no email identifier', () => {
    const body = JSON.stringify({
      created_at: '2026-08-21T10:00:00.000Z',
      data: {},
      type: 'email.delivered',
    });
    try {
      parseResendFeedbackDetailed(verify(body));
      expect.unreachable('payload without an identifier was accepted');
    } catch (error) {
      const diagnostic = (error as ResendFeedbackBoundaryError).diagnostic();
      expect(diagnostic.reason).toBe('payload-schema');
      expect(diagnostic.schemaIssuesObserved).toBeGreaterThan(0);
    }
  });

  it('records unexpected top-level fields by name without their values', () => {
    const body = deliveredBody({ recipient_note: 'someone@example.com' });
    const { diagnostic } = parseResendFeedbackDetailed(verify(body));
    expect(diagnostic.payloadExtraFieldNames).toEqual(['recipient_note']);
    expect(JSON.stringify(diagnostic)).not.toContain('someone@example.com');
  });
});
