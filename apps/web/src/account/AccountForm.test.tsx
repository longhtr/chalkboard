/** Proves registration cannot authenticate before email verification and login exposes password recovery. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountForm } from './AccountForm';

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

describe('AccountForm email verification', () => {
  it('creates the session only after the registration code is verified', async () => {
    const authenticated = vi.fn();
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(
          { email: 'ada@example.com', verificationRequired: true },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            user: {
              displayName: 'Ada',
              email: 'ada@example.com',
              id: 'user-1',
            },
          },
          201,
        ),
      );
    render(
      <AccountForm
        mode="register"
        offline={false}
        onAuthenticated={authenticated}
        onModeChange={vi.fn()}
        onRefreshSession={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Ada' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'correct horse' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct horse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Verify your email before creating the account'),
    ).toBeVisible();
    expect(authenticated).not.toHaveBeenCalled();
    expect(screen.getByText(/email body is completely empty/u)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resets a forgotten password with a subject-line email code', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ verificationRequired: true }, 202))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(
      <AccountForm
        mode="login"
        offline={false}
        onAuthenticated={vi.fn()}
        onModeChange={vi.fn()}
        onRefreshSession={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Password reset email'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(
      await screen.findByText(/email body is completely empty/u),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Password reset code'), {
      target: { value: '12345678' },
    });
    fireEvent.change(screen.getByLabelText('Reset new password'), {
      target: { value: 'new correct horse' },
    });
    fireEvent.change(screen.getByLabelText('Confirm reset password'), {
      target: { value: 'new correct horse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(
      await screen.findByText(
        'Password updated. Sign in with your new password.',
      ),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
