/**
 * Controls session responses and overlapping transitions to prove cache use,
 * offline identity, refresh, authentication, expiry, and stale-response rejection.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../test/assertions';
import { useSession, type User } from './useSession';

const signedIn: User = {
  displayName: 'Current user',
  email: 'current@example.com',
  id: 'current-user',
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useSession transition ordering', () => {
  it('does not let an older restoration overwrite a newer authentication', async () => {
    let finishRestore: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishRestore = resolve;
        }),
    );
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());

    act(() => result.current.authenticate(signedIn));
    expect(result.current.session).toEqual({
      status: 'authenticated',
      user: signedIn,
    });
    await act(async () => {
      finishRestore?.(
        new Response(
          JSON.stringify({
            user: {
              displayName: 'Stale user',
              email: 'stale@example.com',
              id: 'stale-user',
            },
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        ),
      );
      await Promise.resolve();
    });

    expect(result.current.session).toEqual({
      status: 'authenticated',
      user: signedIn,
    });
    expect(
      JSON.parse(
        requiredTestValue(
          localStorage.getItem('chalkboard:last-account'),
          'cached account record',
        ),
      ),
    ).toEqual(signedIn);
  });

  it('does not restore identity after an explicit local sign-out transition', async () => {
    let finishRestore: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishRestore = resolve;
        }),
    );
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());

    act(() => result.current.signOut());
    await act(async () => {
      finishRestore?.(
        new Response(JSON.stringify({ user: signedIn }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      );
      await Promise.resolve();
    });

    expect(result.current.session).toEqual({ status: 'anonymous', user: null });
    expect(localStorage.getItem('chalkboard:last-account')).toBeNull();
  });
});
