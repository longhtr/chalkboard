/** Proves an invitation is answered once, and that a failed answer is reported. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardInvites } from './BoardInvites';
import type { BoardInvitation } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

const invitation: BoardInvitation = {
  boardId: 'board-1',
  invitedAt: '2026-08-24T12:00:00.000Z',
  invitedByDisplayName: 'Grace',
  role: 'editor',
  title: 'Analysis notes',
};

function renderInvites(
  overrides: Partial<Parameters<typeof BoardInvites>[0]> = {},
) {
  const props = {
    invitations: [invitation],
    onAccept: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    onReject: vi.fn().mockResolvedValue(undefined),
    onSessionExpired: vi.fn(),
    state: 'ready' as const,
    ...overrides,
  };
  render(<BoardInvites {...props} />);
  return props;
}

describe('BoardInvites', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ acceptsBoardInvitations: true }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows who offered the board and what it would grant', () => {
    renderInvites();
    expect(screen.getByText('Analysis notes')).toBeVisible();
    expect(screen.getByText(/Grace/u)).toHaveTextContent('Can edit');
  });

  it('keeps the new-invite preference with the invitations it controls', async () => {
    const fetch = vi.mocked(globalThis.fetch);
    renderInvites();
    const toggle = await screen.findByRole('switch', {
      name: 'Do not accept new invites',
    });
    await vi.waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fetch.mockResolvedValueOnce(
      jsonResponse({ acceptsBoardInvitations: false }),
    );
    fireEvent.click(toggle);
    await vi.waitFor(() =>
      expect(toggle).toHaveAttribute('aria-checked', 'true'),
    );
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/account/board-invitations',
      expect.objectContaining({
        body: JSON.stringify({ acceptsBoardInvitations: false }),
        method: 'PATCH',
      }),
    );
    expect(screen.getByText('New board invites are blocked.')).toBeVisible();
  });

  it('accepts an invitation once', async () => {
    const props = renderInvites();
    const accept = screen.getByRole('button', { name: 'Accept' });
    fireEvent.click(accept);
    // Both answers decide the same row, so the second press must not start a
    // race the loser would report as a failure that had in fact happened.
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(props.onAccept).toHaveBeenCalledExactlyOnceWith('board-1');
    expect(props.onReject).not.toHaveBeenCalled();
  });

  it('declines without accepting', () => {
    const props = renderInvites();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(props.onReject).toHaveBeenCalledExactlyOnceWith('board-1');
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it('reports an answer the server refused', async () => {
    renderInvites({
      onAccept: vi.fn().mockRejectedValue(new Error('Invitation not found')),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invitation not found',
    );
  });

  it('says when there is nothing to answer', () => {
    renderInvites({ invitations: [] });
    expect(screen.getByText('No pending invites.')).toBeVisible();
  });

  it('asks a signed-out reader to sign in rather than showing an empty list', () => {
    renderInvites({ invitations: [], state: 'signed-out' });
    expect(
      screen.getByText('Sign in to see boards shared with you.'),
    ).toBeVisible();
  });
});
