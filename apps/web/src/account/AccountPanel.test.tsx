/**
 * User-facing account examples for field validation, focus after failure,
 * registration mode, board management, and unavailable cloud state.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../test/assertions';
import { AccountPanel } from './AccountPanel';

function renderAnonymousPanel() {
  return render(
    <AccountPanel
      onAuthenticated={vi.fn()}
      onClose={vi.fn()}
      onRefreshSession={vi.fn()}
      onSessionExpired={vi.fn()}
      onSignOut={vi.fn()}
      session={{ status: 'anonymous', user: null }}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AccountPanel authentication form', () => {
  it('focuses email without enabling completion when the panel opens', async () => {
    renderAnonymousPanel();

    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute('autocomplete', 'off');

    email.focus();
    let blurEvents = 0;
    let focusEvents = 0;
    email.addEventListener('blur', () => {
      blurEvents += 1;
    });
    email.addEventListener('focus', () => {
      focusEvents += 1;
    });
    fireEvent.change(email, { target: { value: 'a' } });
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveFocus();
    expect({ blurEvents, focusEvents }).toEqual({
      blurEvents: 1,
      focusEvents: 1,
    });
  });

  it('does not steal focus after a fast registration-field change', async () => {
    renderAnonymousPanel();
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus());
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const displayName = screen.getByLabelText('Display name');
    const email = screen.getByLabelText('Email');
    displayName.focus();
    fireEvent.change(displayName, { target: { value: 'Ada Browser' } });
    email.focus();
    fireEvent.change(email, { target: { value: 'ada@example.com' } });
    requiredTestValue(frames[0], 'registration focus frame')(performance.now());

    expect(email).toHaveFocus();
    expect(email).toHaveValue('ada@example.com');
    expect(displayName).toHaveValue('Ada Browser');
  });

  it('keeps demo accounts available and exposes guarded registration', () => {
    renderAnonymousPanel();

    expect(
      screen.getByText('Want to explore cloud boards first?'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View demo accounts' }));
    expect(
      screen.getByRole('dialog', { name: 'Choose a demo account' }),
    ).toBeVisible();
    expect(screen.getAllByText('chalkboard-demo')).toHaveLength(5);
    expect(screen.getByText('demo5@chalkboard.invalid')).toBeVisible();
    expect(screen.getByText('These are shared demo accounts.')).toBeVisible();
    expect(
      screen.getByText(/Content and sessions reset daily at 00:00 UTC/u),
    ).toBeVisible();
    fireEvent.click(
      requiredTestValue(
        screen.getAllByRole('button', { name: 'Use account' })[0],
        'first demo account button',
      ),
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveValue(
      'demo1@chalkboard.invalid',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('chalkboard-demo');
    expect(
      screen.getByText('Want to explore cloud boards first?'),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('I am not a robot')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Create account' }),
    ).toBeDisabled();
  });

  it('keeps writable demo behavior simple and explains the daily reset', () => {
    render(
      <AccountPanel
        onAuthenticated={vi.fn()}
        onClose={vi.fn()}
        onRefreshSession={vi.fn()}
        onSessionExpired={vi.fn()}
        onSignOut={vi.fn()}
        session={{
          status: 'authenticated',
          user: {
            displayName: 'Cloud Demo 1',
            email: 'demo1@chalkboard.invalid',
            id: 'demo-user',
            isDemo: true,
          },
        }}
      />,
    );

    expect(screen.getByText('This is a shared demo account.')).toBeVisible();
    expect(screen.getByText(/reset daily at 00:00 UTC/u)).toBeVisible();
    // The partition rule is a real limit on cloud features, so the notice must
    // not claim they work normally without qualification.
    expect(
      screen.queryByText(/Cloud features work normally/u),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Sharing works only between demo accounts/u),
    ).toBeVisible();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  it('shows sign-out failure immediately above the sign-out button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unable to sign out' }), {
        headers: { 'content-type': 'application/json' },
        status: 503,
      }),
    );
    render(
      <AccountPanel
        onAuthenticated={vi.fn()}
        onClose={vi.fn()}
        onRefreshSession={vi.fn()}
        onSessionExpired={vi.fn()}
        onSignOut={vi.fn()}
        session={{
          status: 'authenticated',
          user: {
            displayName: 'Ada',
            email: 'ada@example.com',
            id: 'user-1',
            isDemo: false,
          },
        }}
      />,
    );

    const signOut = screen.getByRole('button', { name: 'Sign out' });
    fireEvent.click(signOut);
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(
      'Reconnect before signing out so this session can be closed safely.',
    );
    expect(error.nextElementSibling).toBe(signOut);
  });

  it('focuses registration errors in visual order and clears corrected fields', () => {
    renderAnonymousPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const displayName = screen.getByLabelText('Display name');
    const registrationForm = requiredTestValue(
      displayName.closest('form'),
      'registration form',
    );
    fireEvent.submit(registrationForm);
    expect(displayName).toHaveFocus();
    expect(
      screen.getByText('Enter the name people will see on shared boards.'),
    ).toBeInTheDocument();

    fireEvent.change(displayName, { target: { value: 'Ada' } });
    expect(
      screen.queryByText('Enter the name people will see on shared boards.'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'correct horse' },
    });
    const confirmation = screen.getByLabelText('Confirm password');
    fireEvent.change(confirmation, { target: { value: 'different horse' } });
    fireEvent.submit(registrationForm);

    expect(confirmation).toHaveFocus();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('titles the password reset step rather than leaving it as sign-in', () => {
    renderAnonymousPanel();

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Sign in',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Reset password',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Sign in',
    );
  });
});
