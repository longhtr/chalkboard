/** Proves that Share loads owner controls while non-owners receive only their effective access summary. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
