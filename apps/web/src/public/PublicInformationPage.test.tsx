/** Proves public routes plus the dismissible in-workspace information dialog. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PublicInformationDialog,
  PublicInformationPage,
} from './PublicInformationPage';
import { isPublicInformationPath } from './publicRoutes';

afterEach(cleanup);

describe('PublicInformationPage', () => {
  it.each([
    ['/privacy', 'Privacy'],
    ['/privacy-policy', 'Privacy'],
    ['/terms', 'Terms of use'],
    ['/terms-of-use', 'Terms of use'],
    ['/acceptable-use', 'Acceptable use'],
    ['/retention', 'Data retention'],
    ['/account-deletion', 'Account deletion'],
    ['/contact', 'Contact'],
  ])('renders %s as a substantive public route', (pathname, heading) => {
    expect(isPublicInformationPath(pathname)).toBe(true);
    const { container } = render(<PublicInformationPage pathname={pathname} />);
    expect(
      screen.getByRole('heading', { level: 1, name: heading }),
    ).toBeVisible();
    expect(container.textContent?.length).toBeGreaterThan(250);
    expect(
      screen.getByRole('navigation', { name: 'Public information' }),
    ).toBeVisible();
  });

  it('discloses the human-support provider separately from automated email', () => {
    render(<PublicInformationPage pathname="/privacy" />);

    expect(screen.getByText(/Zoho Mail processes addresses/)).toHaveTextContent(
      'Zoho is not used for automated account messages',
    );
    expect(screen.getByText(/Human support correspondence/)).toHaveTextContent(
      'deleted from the active mailbox',
    );
  });

  it('offers private email and a separate public issue tracker', () => {
    render(<PublicInformationPage pathname="/contact" />);

    expect(
      screen.getByRole('link', { name: 'Email Chalkboard support' }),
    ).toHaveAttribute('href', 'mailto:support@chalkboard.space');
    expect(
      screen.getByRole('link', { name: 'Open the public issue tracker' }),
    ).toHaveAttribute('href', 'https://github.com/longhtr/chalkboard/issues');
    expect(screen.getByText(/This monitored mailbox/)).toHaveTextContent(
      'provided through Zoho Mail',
    );
  });

  it('dismisses the in-workspace dialog from its backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PublicInformationDialog pathname="/privacy" onClose={onClose} />,
    );
    expect(screen.getByRole('dialog', { name: 'Privacy' })).toBeInTheDocument();

    const backdrop = container.querySelector(
      '.public-information-dialog-backdrop',
    );
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as Element);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not claim unrelated SPA routes', () => {
    expect(isPublicInformationPath('/boards/example')).toBe(false);
  });
});
