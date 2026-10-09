/** Proves that Share loads owner controls while non-owners receive only their effective access summary. */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardAccessPanel } from './BoardAccessPanel';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BoardAccessPanel', () => {
  it('loads owner membership and moves focus to the invitation field', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/members')) {
        return jsonResponse({
          members: [
            {
              displayName: 'Ada',
              email: 'ada@example.com',
              role: 'owner',
              userId: 'user-1',
            },
          ],
        });
      }
      if (url.endsWith('/invite-links')) return jsonResponse({ links: [] });
      return jsonResponse({ error: 'Not found' }, 404);
    });

    render(
      <BoardAccessPanel
        board={{ id: 'board-1', role: 'owner', title: 'Shared board' }}
        onClose={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('region', { name: 'Manage Shared board' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Member email')).toHaveFocus(),
    );
    expect(screen.getByText('ada@example.com')).toBeVisible();
  });

  it('reports a share that produced an invitation rather than a member', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/members') && init?.method === 'POST') {
        // Somebody new is offered the board. Decoding this as a member is what
        // used to fail the whole share with an invalid-response error.
        return jsonResponse(
          {
            invitation: {
              boardId: 'board-1',
              invitedAt: '2026-08-24T12:00:00.000Z',
              invitedByDisplayName: 'Ada',
              role: 'editor',
              title: 'Shared board',
            },
          },
          201,
        );
      }
      if (url.endsWith('/members')) {
        return jsonResponse({
          members: [
            {
              displayName: 'Ada',
              email: 'ada@example.com',
              role: 'owner',
              userId: 'user-1',
            },
          ],
        });
      }
      if (url.endsWith('/invite-links')) return jsonResponse({ links: [] });
      return jsonResponse({ error: 'Not found' }, 404);
    });

    render(
      <BoardAccessPanel
        board={{ id: 'board-1', role: 'owner', title: 'Shared board' }}
        onClose={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );
    await screen.findByRole('region', { name: 'Manage Shared board' });

    fireEvent.change(screen.getByLabelText('Member email'), {
      target: { value: 'grace@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invite sent to grace@example.com',
    );
    // The invitation grants nothing yet, so it must not join the list of
    // people who can already open the board.
    expect(screen.queryByText('grace@example.com')).not.toBeInTheDocument();
  });

  it('names sharing with yourself instead of denying the account exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/members')) {
        return jsonResponse({
          members: [
            {
              displayName: 'Ada',
              email: 'ada@example.com',
              role: 'owner',
              userId: 'user-1',
            },
          ],
        });
      }
      if (url.endsWith('/invite-links')) return jsonResponse({ links: [] });
      return jsonResponse({ error: 'Not found' }, 404);
    });

    render(
      <BoardAccessPanel
        board={{ id: 'board-1', role: 'owner', title: 'Shared board' }}
        onClose={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );
    await screen.findByRole('region', { name: 'Manage Shared board' });

    fireEvent.change(screen.getByLabelText('Member email'), {
      target: { value: 'Ada@Example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already own this board.',
    );
  });

  it('re-reads membership when the board access changes underneath it', async () => {
    let members = [
      {
        displayName: 'Ada',
        email: 'ada@example.com',
        role: 'owner',
        userId: 'user-1',
      },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/invitations'))
        return jsonResponse({ invitations: [] });
      if (url.endsWith('/members')) return jsonResponse({ members });
      if (url.endsWith('/invite-links')) return jsonResponse({ links: [] });
      return jsonResponse({ error: 'Not found' }, 404);
    });

    const view = render(
      <BoardAccessPanel
        accessRevision={0}
        board={{ id: 'board-1', role: 'owner', title: 'Shared board' }}
        onClose={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );
    await screen.findByText('ada@example.com');

    // Somebody redeemed a link or accepted an invite. Without the re-read the
    // owner would keep looking at a list that no longer describes the board.
    members = [
      ...members,
      {
        displayName: 'Grace',
        email: 'grace@example.com',
        role: 'editor',
        userId: 'user-2',
      },
    ];
    view.rerender(
      <BoardAccessPanel
        accessRevision={1}
        board={{ id: 'board-1', role: 'owner', title: 'Shared board' }}
        onClose={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );

    expect(await screen.findByText('grace@example.com')).toBeVisible();
  });

  it('explains non-owner access without requesting the owner member list', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');

    render(
      <BoardAccessPanel
        board={{ id: 'board-1', role: 'viewer', title: 'Shared board' }}
        onClose={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Board access' })).toBeVisible();
    expect(screen.getByText(/Your access is/u)).toHaveTextContent('viewer');
    expect(fetch).not.toHaveBeenCalled();
  });
});
