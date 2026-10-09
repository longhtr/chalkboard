/** Covers Resend acceptance, idempotent retry bounds, and failure classification. */
import { describe, expect, it, vi } from 'vitest';

import { createResendVerificationEmailSender } from './resendVerificationEmail.js';
import { VerificationEmailDeliveryError } from './verificationEmail.js';

const configuration = {
  apiKey: 're_test_secret_key_value',
  from: 'Chalkboard <accounts@chalkboard.space>',
  publicOrigin: 'https://chalkboard.space',
  replyTo: 'support@chalkboard.space',
};

const intentId = '7f1d0c2e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

/** Reads the request the sender issued on a given attempt. */
function requestInit(
  fetchImpl: { mock: { calls: unknown[][] } },
  attempt: number,
) {
  const call = fetchImpl.mock.calls[attempt];
  if (call === undefined) throw new Error(`no request on attempt ${attempt}`);
  return call[1] as RequestInit;
}

function requestHeaders(
  fetchImpl: { mock: { calls: unknown[][] } },
  attempt: number,
): Record<string, string> {
  return requestInit(fetchImpl, attempt).headers as Record<string, string>;
}

function senderWith(fetchImpl: typeof fetch) {
  return createResendVerificationEmailSender(configuration, {
    fetchImplementation: fetchImpl,
    retryDelayMs: 0,
  });
}

function send(sender: ReturnType<typeof senderWith>) {
  return sender.send({
    code: '1234-5678',
    intentId,
    purpose: 'registration',
    to: 'person@example.com',
  });
}

describe('createResendVerificationEmailSender', () => {
  it('returns the provider identifier after one accepted attempt', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: 'email-1' }));
    const delivery = await send(senderWith(fetchImpl as never));
    expect(delivery.providerMessageId).toBe('email-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(delivery.acceptanceDiagnostic?.request).toMatchObject({
      action: 'resend:SendEmail',
      attemptsMade: 1,
      idempotent: true,
      maxAttempts: 2,
    });
  });

  it('keys the send with the durable intent identifier', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: 'email-1' }));
    await send(senderWith(fetchImpl as never));
    const headers = requestHeaders(fetchImpl, 0);
    expect(headers['idempotency-key']).toBe(intentId);
    expect(headers['authorization']).toBe(`Bearer ${configuration.apiKey}`);
  });

  it('sends one recipient, the configured sender, and a generic subject', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: 'email-1' }));
    await send(senderWith(fetchImpl as never));
    const body = JSON.parse(requestInit(fetchImpl, 0).body as string);
    expect(body.to).toEqual(['person@example.com']);
    expect(body.from).toBe(configuration.from);
    expect(body.reply_to).toBe(configuration.replyTo);
    expect(body.subject).toBe('Confirm your Chalkboard account');
    expect(body.subject).not.toContain('1234-5678');
    expect(body.text).toContain('1234-5678');
    expect(body.html).toContain('1234-5678');
  });

  it('retries once under the same key after a server failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { name: 'application_error' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'email-2' }));
    const delivery = await send(senderWith(fetchImpl as never));
    expect(delivery.providerMessageId).toBe('email-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect([
      requestHeaders(fetchImpl, 0)['idempotency-key'],
      requestHeaders(fetchImpl, 1)['idempotency-key'],
    ]).toEqual([intentId, intentId]);
  });

  it('retries once under the same key after a transport failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'email-3' }));
    const delivery = await send(senderWith(fetchImpl as never));
    expect(delivery.providerMessageId).toBe('email-3');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries once when the response body fails mid-stream', async () => {
    // A connection that drops after the headers arrive leaves acceptance just
    // as unknown as one that never connected.
    const truncated = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('connection reset'));
        },
      }),
      { status: 200 },
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'email-4' }));
    const delivery = await send(senderWith(fetchImpl as never));
    expect(delivery.providerMessageId).toBe('email-4');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestHeaders(fetchImpl, 1)['idempotency-key']).toBe(intentId);
  });

  it('classifies a body that fails on both attempts as an ambiguous transport failure', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('connection reset'));
            },
          }),
          { status: 200 },
        ),
    );
    await expect(send(senderWith(fetchImpl as never))).rejects.toMatchObject({
      certainty: 'ambiguous',
      failureClass: 'transport',
      providerErrorName: 'TransportError',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops after the second attempt and reports an ambiguous outcome', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    await expect(send(senderWith(fetchImpl as never))).rejects.toMatchObject({
      certainty: 'ambiguous',
      failureClass: 'transport',
      providerErrorName: 'TransportError',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, 'rate_limit_exceeded', 'transport', 'RateLimitExceeded'],
    [429, 'daily_quota_exceeded', 'provider-rejection', 'QuotaExceeded'],
    [429, 'monthly_quota_exceeded', 'provider-rejection', 'QuotaExceeded'],
    [451, 'security_error', 'provider-rejection', 'SecurityError'],
    [403, 'invalid_api_key', 'configuration', 'InvalidApiKey'],
    [401, 'missing_api_key', 'configuration', 'MissingApiKey'],
    [401, 'restricted_api_key', 'configuration', 'RestrictedApiKey'],
    [422, 'invalid_from_address', 'configuration', 'InvalidFromAddress'],
    [422, 'missing_required_field', 'configuration', 'ValidationError'],
    [400, 'invalid_idempotency_key', 'configuration', 'InvalidIdempotencyKey'],
    [409, 'invalid_idempotent_request', 'configuration', 'IdempotencyConflict'],
    [403, 'validation_error', 'configuration', 'ValidationError'],
    [400, 'validation_error', 'provider-rejection', 'ValidationError'],
  ])(
    'classifies %i %s as a rejected %s failure without retrying',
    async (status, name, failureClass, providerErrorName) => {
      const fetchImpl = vi.fn(async () => jsonResponse(status, { name }));
      await expect(send(senderWith(fetchImpl as never))).rejects.toMatchObject({
        certainty: 'rejected',
        failureClass,
        httpStatusCode: status,
        providerErrorName,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('treats a concurrent request under the same key as ambiguous without racing it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { name: 'concurrent_idempotent_requests' }),
    );
    await expect(send(senderWith(fetchImpl as never))).rejects.toMatchObject({
      certainty: 'ambiguous',
      providerErrorName: 'ConcurrentIdempotentRequest',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 and reports ambiguity when both attempts fail', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, {}));
    await expect(send(senderWith(fetchImpl as never))).rejects.toMatchObject({
      certainty: 'ambiguous',
      failureClass: 'transport',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats an acceptance with no identifier as ambiguous', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    await expect(send(senderWith(fetchImpl as never))).rejects.toMatchObject({
      certainty: 'ambiguous',
      providerErrorName: 'InvalidProviderResponse',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses an intent identifier that cannot key an idempotent send', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: 'email-1' }));
    const sender = senderWith(fetchImpl as never);
    await expect(
      sender.send({
        code: '1234-5678',
        intentId: 'x'.repeat(257),
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).rejects.toBeInstanceOf(VerificationEmailDeliveryError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never places the API key or recipient in a failure diagnostic', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, {
        message: `rejected for person@example.com with ${configuration.apiKey}`,
        name: 'invalid_from_address',
      }),
    );
    try {
      await send(senderWith(fetchImpl as never));
      expect.unreachable('refusal was not raised');
    } catch (error) {
      const serialized = JSON.stringify(
        (error as VerificationEmailDeliveryError).diagnostic(),
      );
      expect(serialized).not.toContain(configuration.apiKey);
      expect(serialized).not.toContain('person@example.com');
    }
  });
});
