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
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(
      <AccountSettings
        available
        onSessionExpired={vi.fn()}
        onUserUpdated={updated}
        user={{
          displayName: 'Ada',
          email: 'ada@example.com',
          id: 'user-1',
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'Ada Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save username' }));
    await vi.waitFor(() => expect(updated).toHaveBeenCalledTimes(1));

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
    expect(
      await screen.findByRole('region', { name: 'Verify new email' }),
    ).toBeVisible();
    expect(screen.getByText(/email body is completely empty/u)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await vi.waitFor(() => expect(updated).toHaveBeenCalledTimes(2));

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
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password updated.')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
