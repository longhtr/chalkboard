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

afterEach(cleanup);

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

  it('shows the delivery outage and demo accounts on sign-in and registration', () => {
    renderAnonymousPanel();

    expect(
      screen.getByText('Registration is temporarily unavailable.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      screen.getByText('Registration is temporarily unavailable.'),
    ).toBeVisible();
    expect(
      screen.getByText(/Verification emails are not currently working/u),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'View demo accounts' }));
    expect(
      screen.getByRole('dialog', { name: 'Choose a demo account' }),
    ).toBeVisible();
    expect(screen.getAllByText('chalkboard-demo')).toHaveLength(5);
    expect(screen.getByText('demo5@chalkboard.invalid')).toBeVisible();
    expect(
      screen.getByText(/These accounts are public and shared/u),
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
      screen.getByText('Registration is temporarily unavailable.'),
    ).toBeVisible();
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
});
