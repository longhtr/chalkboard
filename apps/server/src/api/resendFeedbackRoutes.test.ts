/** Proves Resend feedback is processed only after real signature verification. */
import { createHmac, randomBytes } from 'node:crypto';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmailFeedbackService } from '../email/feedback.js';
import { createResendWebhookVerifier } from '../email/resendFeedback.js';
import { installResendFeedbackRoutes } from './resendFeedbackRoutes.js';

const apps: ReturnType<typeof Fastify>[] = [];
const secretBytes = randomBytes(32);
const signingSecret = `whsec_${secretBytes.toString('base64')}`;
const messageId = 'msg_route';

function feedback(): EmailFeedbackService & {
  process: ReturnType<typeof vi.fn>;
} {
  return { process: vi.fn(async () => ({ outcome: 'processed' as const })) };
}

function body(type = 'email.delivered'): string {
  return JSON.stringify({
    created_at: '2026-08-21T10:00:00.000Z',
    data: { email_id: 'provider-message', to: ['someone@example.com'] },
    type,
  });
}

function signedHeaders(payload: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const digest = createHmac('sha256', secretBytes)
    .update(`${messageId}.${timestamp}.${payload}`, 'utf8')
    .digest('base64');
  return {
    'content-type': 'application/json',
    'svix-id': messageId,
    'svix-signature': `v1,${digest}`,
    'svix-timestamp': timestamp,
  };
}

function buildApp(service: EmailFeedbackService) {
  const app = Fastify({ logger: false });
  apps.push(app);
  installResendFeedbackRoutes(app, {
    feedback: service,
    verifier: createResendWebhookVerifier({ signingSecret }),
  });
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Resend feedback HTTP route', () => {
  it('processes a correctly signed notification', async () => {
    const service = feedback();
    const app = buildApp(service);
    const payload = body();
    const response = await app.inject({
      headers: signedHeaders(payload),
      method: 'POST',
      payload,
      url: '/api/email-feedback/resend',
    });
    expect(response.statusCode).toBe(204);
    expect(service.process).toHaveBeenCalledWith({
      eventType: 'delivery',
      occurredAt: new Date('2026-08-21T10:00:00.000Z'),
      providerEventId: messageId,
      providerMessageId: 'provider-message',
    });
  });

  it('rejects an unsigned notification without processing it', async () => {
    const service = feedback();
    const app = buildApp(service);
    const payload = body();
    const response = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload,
      url: '/api/email-feedback/resend',
    });
    expect(response.statusCode).toBe(400);
    expect(service.process).not.toHaveBeenCalled();
  });

  it('rejects a body altered after signing', async () => {
    const service = feedback();
    const app = buildApp(service);
    const headers = signedHeaders(body());
    const response = await app.inject({
      headers,
      method: 'POST',
      payload: body('email.bounced'),
      url: '/api/email-feedback/resend',
    });
    expect(response.statusCode).toBe(400);
    expect(service.process).not.toHaveBeenCalled();
  });

  it('accepts and ignores an unsupported event without processing it', async () => {
    const service = feedback();
    const app = buildApp(service);
    const payload = body('email.opened');
    const response = await app.inject({
      headers: signedHeaders(payload),
      method: 'POST',
      payload,
      url: '/api/email-feedback/resend',
    });
    expect(response.statusCode).toBe(204);
    expect(service.process).not.toHaveBeenCalled();
  });

  it('reports processing failure as retryable without leaking the payload', async () => {
    const service: EmailFeedbackService = {
      process: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    };
    const app = buildApp(service);
    const payload = body();
    const response = await app.inject({
      headers: signedHeaders(payload),
      method: 'POST',
      payload,
      url: '/api/email-feedback/resend',
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('someone@example.com');
  });

  it('does not disturb JSON parsing on other routes', async () => {
    const service = feedback();
    const app = buildApp(service);
    app.post('/api/other', async (request) => ({ echoed: request.body }));
    const response = await app.inject({
      method: 'POST',
      payload: { value: 42 },
      url: '/api/other',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ echoed: { value: 42 } });
  });
});
