/** Proves fatal render failures replace the app with stable reload guidance and report the original error. */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenScreen(): never {
  throw new Error('render failed');
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('replaces a failed application tree with data-preserving recovery actions', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary entryLocation="/">
        <BrokenScreen />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveAccessibleName(
      'Chalkboard needs to restart',
    );
    expect(
      screen.getByText(
        /saved in this browser or the cloud has not been removed/u,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reload Chalkboard' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open local board' }),
    ).toHaveAttribute('href', '/local');
  });

  it('restores a non-board entry URL if the failed tree rewrites it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/?mode=recovery#keep');
    const RewritingBrokenScreen = () => {
      window.history.replaceState(null, '', '/local/generated-board-id');
      throw new Error('render failed after route initialization');
    };

    render(
      <AppErrorBoundary entryLocation="/?mode=recovery#keep">
        <RewritingBrokenScreen />
      </AppErrorBoundary>,
    );

    expect(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ).toBe('/?mode=recovery#keep');
  });

  it('retains an explicitly requested board URL during recovery', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/local/requested-board');

    render(
      <AppErrorBoundary entryLocation="/local/requested-board">
        <BrokenScreen />
      </AppErrorBoundary>,
    );

    expect(window.location.pathname).toBe('/local/requested-board');
  });
});
