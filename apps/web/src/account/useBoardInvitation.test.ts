/**
 * Locks the two invitation channels to opposite lifecycles. Pending guidance
 * must survive a session transition so redemption can retry after sign-in; a
 * terminal failure must be dismissible and must never follow a reader onto the
 * sign-in screen after they log out.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './api';
import { useBoardInvitation } from './useBoardInvitation';

const requestApi = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  requestApi,
}));

afterEach(() => {
  requestApi.mockReset();
  window.history.replaceState(null, '', '/');
});

function mount(
  sessionStatus: 'authenticated' | 'anonymous' = 'authenticated',
  viewerIsDemo = false,
) {
  return renderHook(
    (props: { sessionStatus: 'authenticated' | 'anonymous' }) =>
      useBoardInvitation({
        initialToken: 'invite-token',
        onAccepted: vi.fn(),
        onSessionExpired: vi.fn(),
        sessionStatus: props.sessionStatus,
        viewerIsDemo,
      }),
    { initialProps: { sessionStatus } },
  );
}

describe('useBoardInvitation', () => {
  it('clears a terminal failure when the session changes', async () => {
    requestApi.mockRejectedValue(new ApiError('Not found', 404));
    const { result, rerender } = mount();

    await waitFor(() => {
      expect(result.current.error).toBe(
        'This invitation link is invalid, expired, or revoked.',
      );
    });

    rerender({ sessionStatus: 'anonymous' });

    expect(result.current.error).toBeUndefined();
  });

  // Statuses repeat, so retiring a failure by comparing them brought it back
  // the moment the reader signed in again.
  it('keeps a terminal failure retired across signing out and back in', async () => {
    requestApi.mockRejectedValue(new ApiError('Not found', 404));
    const { result, rerender } = mount();

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });

    rerender({ sessionStatus: 'anonymous' });
    expect(result.current.error).toBeUndefined();

    rerender({ sessionStatus: 'authenticated' });
    expect(result.current.error).toBeUndefined();
  });

  it('dismisses a terminal failure without a reload', async () => {
    requestApi.mockRejectedValue(new ApiError('Not found', 404));
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });

    act(() => {
      result.current.dismissError();
    });

    expect(result.current.error).toBeUndefined();
  });

  it('keeps pending guidance across a session transition', async () => {
    requestApi.mockRejectedValue(new ApiError('Unauthorized', 401));
    const { result, rerender } = mount();

    await waitFor(() => {
      expect(result.current.guidance).toBe(
        'Sign in to accept this board invitation.',
      );
    });

    // A 401 retains the token on purpose, so the guidance must outlive the
    // session change that follows it.
    rerender({ sessionStatus: 'anonymous' });

    expect(result.current.guidance).toBe(
      'Sign in to accept this board invitation.',
    );
    expect(result.current.error).toBeUndefined();
  });

  it('reports pending guidance while an unauthenticated reader waits', () => {
    const { result } = mount('anonymous');

    expect(result.current.guidance).toBe(
      'Sign in or create an account to accept this board invitation.',
    );
    expect(result.current.error).toBeUndefined();
    expect(requestApi).not.toHaveBeenCalled();
  });

  it('clears both channels once redemption succeeds', async () => {
    requestApi.mockResolvedValue({ board: { id: 'board-1' } });
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.guidance).toBeUndefined();
    });

    expect(result.current.error).toBeUndefined();
  });
});
