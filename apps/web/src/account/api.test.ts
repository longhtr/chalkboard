/**
 * Proves API decoders reject malformed success payloads and transport handles
 * JSON headers, HTTP errors, timeout, caller cancellation, and empty responses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../test/assertions';
import { ApiError, decodeBoardResponse, requestApi } from './api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function decodeValueResponse(value: unknown): { value: number } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('value' in value) ||
    typeof value.value !== 'number'
  ) {
    throw new TypeError('Invalid value response');
  }
  return { value: value.value };
}

describe('API response decoders', () => {
  it('reconstructs valid boards and rejects unknown roles', () => {
    const response = {
      board: {
        id: 'board-1',
        role: 'editor',
        title: 'Calculus',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    expect(decodeBoardResponse(response)).toEqual(response);
    expect(() =>
      decodeBoardResponse({
        board: { ...response.board, role: 'administrator' },
      }),
    ).toThrow('invalid response');
  });
});

describe('requestApi', () => {
  it('sends JSON and decodes a successful response', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 3 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      requestApi(
        '/api/value',
        {
          body: JSON.stringify({ input: 2 }),
          method: 'POST',
        },
        decodeValueResponse,
      ),
    ).resolves.toEqual({ value: 3 });
    expect(fetch).toHaveBeenCalledWith(
      '/api/value',
      expect.objectContaining({
        headers: expect.any(Headers),
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
    const sentOptions = requiredTestValue(
      fetch.mock.calls[0],
      'API fetch call',
    )[1] as RequestInit;
    if (!(sentOptions.headers instanceof Headers)) {
      throw new Error('Expected normalized request headers');
    }
    expect(sentOptions.headers.get('Content-Type')).toBe('application/json');
  });

  it('retains a validated server request ID on HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Temporary failure' }), {
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req-safe-123',
          },
          status: 503,
        }),
      ),
    );

    await expect(requestApi('/api/value')).rejects.toMatchObject({
      message: 'Temporary failure Reference: req-safe-123.',
      requestId: 'req-safe-123',
      status: 503,
    });
  });

  it('omits the reference from a refusal the reader can act on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'That address is already in use.' }),
          {
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'req-conflict-789',
            },
            status: 409,
          },
        ),
      ),
    );

    await expect(requestApi('/api/value')).rejects.toMatchObject({
      message: 'That address is already in use.',
      requestId: 'req-conflict-789',
      status: 409,
    });
  });

  it('rejects attacker-controlled request IDs rather than displaying them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Temporary failure' }), {
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'private destination@example.com',
          },
          status: 503,
        }),
      ),
    );

    await expect(requestApi('/api/value')).rejects.toMatchObject({
      message: 'Temporary failure',
      requestId: null,
      status: 503,
    });
  });

  it('rejects a successful response that violates its runtime contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: 'three' }), {
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req-decode-456',
          },
        }),
      ),
    );

    await expect(
      requestApi('/api/value', undefined, decodeValueResponse),
    ).rejects.toMatchObject({
      message:
        'Chalkboard returned an invalid response Reference: req-decode-456.',
      requestId: 'req-decode-456',
      status: 200,
    });
  });

  it('rejects an empty response when the caller requires decoded data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(
      requestApi('/api/value', undefined, decodeValueResponse),
    ).rejects.toMatchObject({
      message: 'Chalkboard returned an invalid response',
      status: 204,
    });
  });

  it('aborts an API request that never settles', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(options.signal?.reason);
            });
          }),
      ),
    );

    const request = requestApi('/api/hung');
    const rejection = expect(request).rejects.toMatchObject({
      message: 'Chalkboard is unavailable',
      requestId: null,
      status: null,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
  });

  it('propagates caller cancellation to fetch', async () => {
    const caller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        fetchSignal = options.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          fetchSignal?.addEventListener('abort', () =>
            reject(fetchSignal?.reason),
          );
        });
      }),
    );

    const request = requestApi('/api/cancelled', { signal: caller.signal });
    caller.abort(new DOMException('Cancelled', 'AbortError'));
    await expect(request).rejects.toBeInstanceOf(ApiError);
    expect(requiredTestValue(fetchSignal, 'API fetch signal').aborted).toBe(
      true,
    );
  });
});
