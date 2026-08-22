/**
 * Cross-owner application examples for startup, routing, authentication,
 * invitations, sharing, offline identity, and direct cloud-board resolution.
 * IndexedDB and fetch are controlled; visible behavior is exercised through UI.
 */
import 'fake-indexeddb/auto';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { requiredTestValue } from './test/assertions';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    jsonResponse({ error: 'Authentication required' }, 401),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('opens directly into the drawing workspace while the session resolves', async () => {
    render(<App />);

    expect(
      await screen.findByRole('application', {
        name: 'Chalkboard drawing canvas',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('toolbar', { name: 'Drawing tools' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /mixed text block tool/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /shape tool/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /line \/ curve tool/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /freehand tool/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('API online')).not.toBeInTheDocument();
  });

  it('restores the account at application startup', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
      }),
    );

    render(<App />);

    const accountButton = await screen.findByRole('button', {
      name: 'Open account',
    });
    fireEvent.click(accountButton);
    expect(
      await screen.findByRole('dialog', { name: 'Account' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Account email')).toHaveValue(
      'ada@example.com',
    );
  });

  it('opens the visible account and cloud-board flow', async () => {
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open account' }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create account' }),
    ).toBeInTheDocument();
  });

  it('uses inline validation rather than submitting malformed sign-in data', async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open account' }),
    );
    await screen.findByRole('dialog', { name: 'Sign in' });

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email-address' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      screen.getByText('Enter a valid email address.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves email and clears and focuses password after rejected credentials', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Authentication required' }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Email or password is incorrect' }, 401),
      );
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open account' }),
    );
    await screen.findByRole('dialog', { name: 'Sign in' });

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    fireEvent.change(email, { target: { value: 'nobody@example.com' } });
    fireEvent.change(password, { target: { value: 'random password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText(
        'We couldn’t sign you in. Check your email and password and try again.',
      ),
    ).toBeInTheDocument();
    expect(email).toHaveValue('nobody@example.com');
    expect(password).toHaveValue('');
    await waitFor(() => expect(password).toHaveFocus());
  });

  it('does not load board data through the account dialog', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
      }),
    );
    render(<App />);

    const accountButton = await screen.findByRole('button', {
      name: 'Open account',
    });
    fireEvent.click(accountButton);

    expect(
      await screen.findByRole('dialog', { name: 'Account' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Your boards')).not.toBeInTheDocument();
    // Opening personal settings must not trigger board or invitation work.
    const requested = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input]) => String(input));
    expect(requested.some((url) => url.includes('/api/boards'))).toBe(false);
  });

  it('shows sign-in guidance for a direct cloud route without a session', async () => {
    window.history.replaceState(null, '', '/boards/board-1');
    render(<App />);

    expect(
      await screen.findByText('Sign in to open this cloud board'),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/boards/board-1');
    expect(
      screen.queryByRole('button', { name: 'Share' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('application', { name: 'Chalkboard drawing canvas' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('dialog', { name: 'Sign in' }),
    ).toBeInTheDocument();
  });

  it('opens a remembered cloud board only after session and board confirmation', async () => {
    localStorage.setItem(
      'chalkboard:last-cloud-board',
      JSON.stringify({
        boards: {
          'user-1': [
            {
              kind: 'cloud',
              selection: {
                id: 'board-1',
                role: 'owner',
                title: 'Remembered board',
              },
            },
          ],
        },
        lastAccountId: 'user-1',
      }),
    );
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
        });
      }
      if (url === '/api/boards/board-1') {
        return jsonResponse({
          board: {
            id: 'board-1',
            role: 'owner',
            title: 'Remembered board',
            updatedAt: new Date(0).toISOString(),
          },
        });
      }
      return jsonResponse({ boards: [] });
    });

    render(<App />);

    await waitFor(() =>
      expect(window.location.pathname).toBe('/boards/board-1'),
    );
    expect(screen.getByLabelText('Board title')).toHaveValue(
      'Remembered board',
    );
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('keeps the initialized local route when a remembered cloud board has no session', async () => {
    localStorage.setItem(
      'chalkboard:last-cloud-board',
      JSON.stringify({
        id: 'deleted-board',
        role: 'owner',
        title: 'Old board',
      }),
    );
    let resolveSession: ((response: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveSession = resolve;
        }),
    );

    render(<App />);

    expect(window.location.pathname).not.toBe('/local/local');
    await waitFor(() =>
      expect(window.location.pathname).toMatch(
        /^\/local\/(?!local$)[0-9a-f-]+$/u,
      ),
    );
    const localPath = window.location.pathname;
    await act(async () => {
      requiredTestValue(
        resolveSession,
        'pending session response',
      )(jsonResponse({ error: 'Authentication required' }, 401));
      await Promise.resolve();
    });
    expect(window.location.pathname).toBe(localPath);
    expect(
      screen.queryByText('Sign in to open this cloud board'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Share' }),
    ).not.toBeInTheDocument();
  });

  it('presents inaccessible direct routes without redirecting or clearing local work', async () => {
    window.history.replaceState(null, '', '/boards/missing-board');
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
        });
      }
      return jsonResponse({ error: 'Board not found' }, 404);
    });
    render(<App />);

    expect(
      await screen.findByText(/This cloud board is unavailable\./u),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/boards/missing-board');
    expect(screen.getByLabelText('Board title')).toHaveValue('Untitled board');
  });

  it('explains a remembered board that this account cannot open, on arrival', async () => {
    // Restoring the account's board is what discovers that it is gone, so it
    // has to happen when the session resolves rather than whenever some later
    // cloud request happens to run.
    localStorage.setItem(
      'chalkboard:last-cloud-board',
      JSON.stringify({
        boards: {
          'user-1': [
            {
              kind: 'cloud',
              selection: { id: 'gone', role: 'owner', title: 'Gone' },
            },
          ],
        },
        lastAccountId: 'user-1',
      }),
    );
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
        });
      }
      if (url === '/api/boards/gone') {
        return jsonResponse({ error: 'Board not found' }, 404);
      }
      return jsonResponse({ boards: [] });
    });

    render(<App />);

    expect(
      await screen.findByText(
        /The board this account had open last is no longer available\./u,
      ),
    ).toBeInTheDocument();
  });

  it("waits rather than showing this device's board while a cloud link opens", async () => {
    window.history.replaceState(null, '', '/boards/board-1');
    let releaseBoard = (): void => undefined;
    const boardRequested = new Promise<void>((resolve) => {
      releaseBoard = resolve;
    });
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
        });
      }
      if (url === '/api/boards/board-1') {
        await boardRequested;
        return jsonResponse({
          board: {
            id: 'board-1',
            role: 'owner',
            title: 'Direct board',
            updatedAt: new Date(0).toISOString(),
          },
        });
      }
      return jsonResponse({ boards: [] });
    });
    render(<App />);

    // The local board must not stand in for the one that was asked for, even
    // for the moment the request takes.
    expect(await screen.findByText('Opening the board…')).toBeVisible();
    expect(screen.queryByLabelText('Board title')).not.toBeInTheDocument();

    releaseBoard();
    await waitFor(() =>
      expect(screen.getByLabelText('Board title')).toHaveValue('Direct board'),
    );
  });

  it('resolves an authorized direct cloud route and preserves its stable URL', async () => {
    window.history.replaceState(null, '', '/boards/board-1');
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
        });
      }
      if (url === '/api/boards/board-1') {
        return jsonResponse({
          board: {
            id: 'board-1',
            role: 'owner',
            title: 'Direct board',
            updatedAt: new Date(0).toISOString(),
          },
        });
      }
      return jsonResponse({ boards: [] });
    });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Board title')).toHaveValue('Direct board'),
    );
    expect(window.location.pathname).toBe('/boards/board-1');
    expect(screen.queryByText('Opening cloud board…')).not.toBeInTheDocument();
  });

  it.each([
    { existingReplacement: true, label: 'opens another' },
    { existingReplacement: false, label: 'creates another' },
  ])(
    '$label cloud board after the current board is trashed',
    async ({ existingReplacement }) => {
      window.history.replaceState(null, '', '/boards/current-board');
      const currentBoard = {
        id: 'current-board',
        role: 'owner' as const,
        title: 'Current cloud board',
        updatedAt: new Date(1).toISOString(),
      };
      const remainingBoard = {
        id: 'remaining-board',
        role: 'owner' as const,
        title: 'Remaining cloud board',
        updatedAt: new Date(2).toISOString(),
      };
      const createdBoard = {
        id: 'created-board',
        role: 'owner' as const,
        title: 'Untitled board',
        updatedAt: new Date(3).toISOString(),
      };
      let deleted = false;
      let createRequests = 0;
      vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
        const url = String(input);
        const method = options?.method ?? 'GET';
        if (url === '/api/session') {
          return jsonResponse({
            user: {
              id: 'user-1',
              email: 'ada@example.com',
              displayName: 'Ada',
            },
          });
        }
        if (url === '/api/boards/current-board' && method === 'DELETE') {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        if (url === '/api/boards/current-board') {
          return jsonResponse({ board: currentBoard });
        }
        if (url === '/api/boards/trash') {
          return jsonResponse({
            boards: deleted
              ? [
                  {
                    deletedAt: new Date(4).toISOString(),
                    id: currentBoard.id,
                    title: currentBoard.title,
                  },
                ]
              : [],
          });
        }
        if (url === '/api/boards' && method === 'POST') {
          createRequests += 1;
          return jsonResponse({ board: createdBoard }, 201);
        }
        if (url === '/api/boards') {
          return jsonResponse({
            boards: deleted
              ? existingReplacement
                ? [remainingBoard]
                : []
              : existingReplacement
                ? [currentBoard, remainingBoard]
                : [currentBoard],
          });
        }
        return jsonResponse({ error: 'Not found' }, 404);
      });

      render(<App />);
      await waitFor(() =>
        expect(screen.getByLabelText('Board title')).toHaveValue(
          currentBoard.title,
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Open board menu' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open boards' }));
      const library = await screen.findByRole('dialog', { name: 'Boards' });
      const currentEntry = requiredTestValue(
        await within(library)
          .findByRole('button', {
            name: `Open cloud board ${currentBoard.title}`,
          })
          .then((button) => button.closest('li')),
        'current cloud board entry',
      );
      fireEvent.click(
        within(currentEntry).getByRole('button', { name: 'Trash' }),
      );

      const expected = existingReplacement ? remainingBoard : createdBoard;
      await waitFor(() =>
        expect(screen.getByLabelText('Board title')).toHaveValue(
          expected.title,
        ),
      );
      expect(window.location.pathname).toBe(`/boards/${expected.id}`);
      expect(createRequests).toBe(existingReplacement ? 0 : 1);
    },
  );

  it('redeems a server-authorized invitation token and removes it from the URL', async () => {
    const token = 'r'.repeat(43);
    window.history.replaceState(null, '', `/#invite=${token}`);
    const invitedBoard = {
      id: 'invited-board',
      role: 'viewer' as const,
      title: 'Invited board',
      updatedAt: new Date(0).toISOString(),
    };
    vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: {
            id: 'user-2',
            email: 'grace@example.com',
            displayName: 'Grace',
          },
        });
      }
      if (url === '/api/board-invites/redeem' && options?.method === 'POST') {
        expect(JSON.parse(String(options.body))).toEqual({ token });
        return jsonResponse({ board: invitedBoard });
      }
      return jsonResponse({ boards: [] });
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Board title')).toHaveValue('Invited board'),
    );
    expect(window.location.pathname).toBe('/boards/invited-board');
    expect(window.location.hash).toBe('');
    expect(
      screen.queryByText('Accepting board invitation…'),
    ).not.toBeInTheDocument();
  });

  it('opens role-specific cloud sharing and access management', async () => {
    window.history.replaceState(null, '', '/boards/board-1');
    const board = {
      id: 'board-1',
      role: 'owner' as const,
      title: 'Direct board',
      updatedAt: new Date(0).toISOString(),
    };
    vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
        });
      }
      if (url === '/api/boards/board-1') return jsonResponse({ board });
      if (url === '/api/boards') return jsonResponse({ boards: [board] });
      if (url === '/api/boards/board-1/invite-links') {
        if (options?.method === 'POST') {
          const role = JSON.parse(String(options.body)).role as
            'editor' | 'viewer';
          return jsonResponse(
            {
              link: {
                expiresAt: '2030-01-01T00:00:00.000Z',
                id: role === 'viewer' ? 'viewer-link' : 'editor-link',
                role,
              },
              token: role === 'viewer' ? 'v'.repeat(43) : 'e'.repeat(43),
            },
            201,
          );
        }
        return jsonResponse({ links: [] });
      }
      if (url === '/api/boards/board-1/members') {
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
      return jsonResponse({ error: 'Not found' }, 404);
    });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Board title')).toHaveValue('Direct board'),
    );
    const share = await screen.findByRole('button', { name: 'Share' });
    fireEvent.click(share);

    expect(
      await screen.findByRole('region', { name: 'Manage Direct board' }),
    ).toBeInTheDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy read-only link' }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/#invite=${'v'.repeat(43)}`,
      ),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy read-and-edit link' }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(
      requiredTestValue(writeText.mock.calls[1], 'second clipboard write')[0],
    ).toBe(`${window.location.origin}/#invite=${'e'.repeat(43)}`);
    expect(
      screen.getByRole('dialog', { name: 'Board access' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Member email')).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close sharing' }));
    expect(
      screen.queryByRole('dialog', { name: 'Board access' }),
    ).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('expires stale identity when membership management is unauthorized', async () => {
    window.history.replaceState(null, '', '/boards/board-1');
    const board = {
      id: 'board-1',
      role: 'owner' as const,
      title: 'Private board',
      updatedAt: new Date(0).toISOString(),
    };
    vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === '/api/session') {
        return jsonResponse({
          user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
        });
      }
      if (url === '/api/boards/board-1') return jsonResponse({ board });
      if (url === '/api/boards') return jsonResponse({ boards: [board] });
      if (url === '/api/boards/board-1/invite-links') {
        return jsonResponse({ links: [] });
      }
      if (url === '/api/boards/board-1/members') {
        if (options?.method === 'POST') {
          return jsonResponse({ error: 'Authentication required' }, 401);
        }
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
      return jsonResponse({ error: 'Not found' }, 404);
    });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Board title')).toHaveValue('Private board'),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const memberEmail = await screen.findByLabelText('Member email');
    fireEvent.change(memberEmail, { target: { value: 'person@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(
      await screen.findByRole('dialog', { name: 'Sign in' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(window.location.pathname).toMatch(/^\/local\//u),
    );
    expect(
      screen.queryByText('Sign in to open this cloud board'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Authentication required'),
    ).not.toBeInTheDocument();
  });

  it('keeps cached identity visible when startup is offline', async () => {
    localStorage.setItem(
      'chalkboard:last-account',
      JSON.stringify({
        id: 'user-1',
        email: 'ada@example.com',
        displayName: 'Ada',
      }),
    );
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('offline'));
    render(<App />);

    const accountButton = await screen.findByRole('button', {
      name: 'Open account',
    });
    fireEvent.click(accountButton);

    expect(
      await screen.findByRole('dialog', { name: 'Account' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Account services are unavailable.'),
    ).toBeInTheDocument();
  });
});
