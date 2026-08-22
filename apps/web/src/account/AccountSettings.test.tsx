/** Proves username, verified email, and current-password-protected password changes. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountSettings } from './AccountSettings';

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

describe('AccountSettings', () => {
  it('updates every personal account field through its owning protocol', async () => {
    const updated = vi.fn();
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            displayName: 'Ada Updated',
            email: 'ada@example.com',
            id: 'user-1',
            isDemo: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { email: 'new@example.com', verificationRequired: true },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            displayName: 'Ada Updated',
            email: 'new@example.com',
            id: 'user-1',
            isDemo: false,
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(
      <AccountSettings
        available
        onAccountDeleted={vi.fn()}
        onSessionExpired={vi.fn()}
        onUserUpdated={updated}
        user={{
          displayName: 'Ada',
          email: 'ada@example.com',
          id: 'user-1',
          isDemo: false,
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'Ada Updated' },
    });
    const saveUsername = screen.getByRole('button', { name: 'Save username' });
    fireEvent.click(saveUsername);
    await vi.waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(
      (await screen.findByText('Username updated.')).nextElementSibling,
    ).toBe(saveUsername);

    fireEvent.change(screen.getByLabelText('Account email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(
      screen.getByLabelText('Current password for email change'),
      {
        target: { value: 'correct horse' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verify new email' }));
    const emailVerificationDialog = await screen.findByRole('dialog', {
      name: 'Verify new email',
    });
    expect(emailVerificationDialog).toBeVisible();
    expect(emailVerificationDialog).toHaveAttribute('aria-modal', 'true');
    expect(emailVerificationDialog.closest('.account-settings')).toBeNull();
    expect(screen.getByText(/expires in 15 minutes/u)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Request a code' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await vi.waitFor(() => expect(updated).toHaveBeenCalledTimes(2));
    const verifyNewEmail = screen.getByRole('button', {
      name: 'Verify new email',
    });
    expect((await screen.findByText('Email updated.')).nextElementSibling).toBe(
      verifyNewEmail,
    );

    fireEvent.change(
      screen.getByLabelText('Current password', { selector: '[minlength]' }),
      {
        target: { value: 'correct horse' },
      },
    );
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new correct horse' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new correct horse' },
    });
    const changePassword = screen.getByRole('button', {
      name: 'Change password',
    });
    fireEvent.click(changePassword);
    const passwordStatus = await screen.findByText('Password updated.');
    expect(passwordStatus).toBeVisible();
    expect(passwordStatus.nextElementSibling).toBe(changePassword);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('uses a separate confirmation step before deleting the account', async () => {
    const deleted = vi.fn();
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    render(
      <AccountSettings
        available
        onAccountDeleted={deleted}
        onSessionExpired={vi.fn()}
        onUserUpdated={vi.fn()}
        user={{
          displayName: 'Ada',
          email: 'ada@example.com',
          id: 'user-1',
          isDemo: false,
        }}
      />,
    );

    const continueButton = screen.getByRole('button', {
      name: 'Continue to account deletion',
    });
    expect(continueButton).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText('Current password for account deletion'),
      { target: { value: 'correct horse' } },
    );
    fireEvent.click(continueButton);

    expect(
      await screen.findByRole('form', { name: 'Confirm account deletion' }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText('Confirm permanent account deletion'),
    ).not.toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/account/deletion/verify-password',
      expect.objectContaining({
        body: JSON.stringify({ currentPassword: 'correct horse' }),
        method: 'POST',
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete account permanently' }),
    );

    await vi.waitFor(() => expect(deleted).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/account',
      expect.objectContaining({
        body: JSON.stringify({ currentPassword: 'correct horse' }),
        method: 'DELETE',
      }),
    );
  });

  it('rejects an incorrect password before showing deletion confirmation', async () => {
    const deleted = vi.fn();
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ error: 'Current password is incorrect' }, 403),
      );
    render(
      <AccountSettings
        available
        onAccountDeleted={deleted}
        onSessionExpired={vi.fn()}
        onUserUpdated={vi.fn()}
        user={{
          displayName: 'Ada',
          email: 'ada@example.com',
          id: 'user-1',
          isDemo: false,
        }}
      />,
    );

    fireEvent.change(
      screen.getByLabelText('Current password for account deletion'),
      { target: { value: 'wrong' } },
    );
    const continueButton = screen.getByRole('button', {
      name: 'Continue to account deletion',
    });
    fireEvent.click(continueButton);

    const error = await screen.findByText('Current password is incorrect');
    expect(error).toBeVisible();
    expect(error.nextElementSibling).toBe(continueButton);
    expect(
      screen.queryByRole('form', { name: 'Confirm account deletion' }),
    ).not.toBeInTheDocument();
    expect(deleted).not.toHaveBeenCalled();
    // No deletion request follows a refused password check.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
