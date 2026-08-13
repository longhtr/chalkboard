/**
 * Locks the two-badge status contract: durability on the left, transport on the
 * right, each a persistent fact rather than a passing notification.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudCollaborator } from '../../collaboration/useCloudBoard';
import { CloudControls } from './CloudControls';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const base = {
  cloudBoardActive: true,
  collaborators: [] as CloudCollaborator[],
  deviceRecoveryState: 'available' as const,
  onOpenAccount: vi.fn(),
  onShare: vi.fn(),
  shareLabel: 'Share',
};

describe('CloudControls', () => {
  it('hides sharing on a local board', () => {
    render(
      <CloudControls
        {...base}
        cloudBoardActive={false}
        connectionState="local"
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Share' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open account' })).toBeVisible();
  });

  describe('durability', () => {
    const typed = (n: number) => ({ n });

    it('shows Synced once the board is settled and the user is idle', () => {
      render(<CloudControls {...base} connectionState="saved" />);

      expect(screen.getByText('Synced')).toBeVisible();
      expect(screen.getByText('Connected')).toBeVisible();
    });

    it('turns yellow the moment the user edits', () => {
      vi.useFakeTimers();
      const view = render(
        <CloudControls
          {...base}
          connectionState="saved"
          editActivity={typed(1)}
        />,
      );
      expect(screen.getByText('Synced')).toBeVisible();

      view.rerender(
        <CloudControls
          {...base}
          connectionState="saved"
          editActivity={typed(2)}
        />,
      );
      expect(screen.getByText('Syncing')).toBeVisible();
      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    });

    it('stays yellow while typing continues, however fast saves complete', () => {
      vi.useFakeTimers();
      // The board reports itself fully saved throughout; only the typing matters.
      const view = render(
        <CloudControls
          {...base}
          connectionState="saved"
          editActivity={typed(0)}
        />,
      );

      for (let keystroke = 1; keystroke <= 12; keystroke += 1) {
        view.rerender(
          <CloudControls
            {...base}
            connectionState="saved"
            editActivity={typed(keystroke)}
          />,
        );
        act(() => vi.advanceTimersByTime(200));
        expect(screen.getByText('Syncing')).toBeVisible();
        expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      }
    });

    it('goes green a quarter second after the user stops', () => {
      vi.useFakeTimers();
      const view = render(
        <CloudControls
          {...base}
          connectionState="saved"
          editActivity={typed(1)}
        />,
      );
      view.rerender(
        <CloudControls
          {...base}
          connectionState="saved"
          editActivity={typed(2)}
        />,
      );

      act(() => vi.advanceTimersByTime(249));
      expect(screen.getByText('Syncing')).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByText('Synced')).toBeVisible();
    });

    it('stays yellow after the user stops until the board is actually settled', () => {
      vi.useFakeTimers();
      render(
        <CloudControls {...base} connectionState="saved" hasPendingWork />,
      );

      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByText('Syncing')).toBeVisible();
      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    });

    it('withholds the claim while typed text is missing from the document', () => {
      vi.useFakeTimers();
      render(<CloudControls {...base} connectionState="saved" draftPending />);

      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByText('Syncing')).toBeVisible();
    });

    it('withholds the claim until the first sync completes', () => {
      render(<CloudControls {...base} connectionState="connecting" />);

      expect(screen.getByText('Syncing')).toBeVisible();
      expect(screen.getByText('Connecting…')).toBeVisible();
    });

    it('stays Synced offline when everything was already durable', () => {
      render(<CloudControls {...base} connectionState="offline" />);

      expect(screen.getByText('Synced')).toBeVisible();
      expect(screen.getByText('Disconnected')).toBeVisible();
    });

    it('reserves red for a board that cannot be written at all', () => {
      render(<CloudControls {...base} connectionState="incompatible" />);

      expect(screen.getByText("Can't sync")).toBeVisible();
    });

    it('stays yellow through sync churn after the user has stopped', () => {
      vi.useFakeTimers();
      const view = render(
        <CloudControls
          {...base}
          connectionState="saved"
          editActivity={typed(1)}
        />,
      );
      view.rerender(
        <CloudControls
          {...base}
          connectionState="saved"
          editActivity={typed(2)}
        />,
      );

      // Trailing acknowledgements keep arriving after the last keystroke. Each
      // one restarts the quiet window rather than blinking the badge green.
      for (let blip = 0; blip < 6; blip += 1) {
        act(() => vi.advanceTimersByTime(200));
        view.rerender(
          <CloudControls
            {...base}
            connectionState="syncing"
            editActivity={typed(2)}
          />,
        );
        act(() => vi.advanceTimersByTime(40));
        view.rerender(
          <CloudControls
            {...base}
            connectionState="saved"
            editActivity={typed(2)}
          />,
        );
        expect(screen.getByText('Syncing')).toBeVisible();
        expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      }

      act(() => vi.advanceTimersByTime(250));
      expect(screen.getByText('Synced')).toBeVisible();
    });

    it('reports changes that cannot be sent while disconnected', () => {
      render(
        <CloudControls {...base} connectionState="offline" hasPendingWork />,
      );

      expect(screen.getByText("Can't sync")).toBeVisible();
      expect(screen.getByText('Disconnected')).toBeVisible();
    });

    it('returns through yellow to green once the connection comes back', () => {
      vi.useFakeTimers();
      const view = render(
        <CloudControls {...base} connectionState="offline" hasPendingWork />,
      );
      expect(screen.getByText("Can't sync")).toBeVisible();

      // Reconnected: the queued work can move again.
      view.rerender(<CloudControls {...base} connectionState="syncing" />);
      expect(screen.getByText('Syncing')).toBeVisible();

      view.rerender(<CloudControls {...base} connectionState="saved" />);
      act(() => vi.advanceTimersByTime(250));
      expect(screen.getByText('Synced')).toBeVisible();
    });

    it('omits durability for a viewer with nothing to save', () => {
      render(
        <CloudControls {...base} connectionState="read-only" viewerRole />,
      );

      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      expect(screen.queryByText('Syncing')).not.toBeInTheDocument();
      // Role and transport are separate badges, so dropping durability costs a
      // viewer neither fact.
      expect(screen.getByText('View only')).toBeVisible();
      expect(screen.getByText('Connected')).toBeVisible();
    });
  });

  describe('transport', () => {
    it('hides a brief reconnect entirely', () => {
      vi.useFakeTimers();
      render(<CloudControls {...base} connectionState="reconnecting" />);

      act(() => vi.advanceTimersByTime(1_999));
      expect(screen.getByText('Connected')).toBeVisible();
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
    });

    it('announces a reconnect that outlasts the grace period', () => {
      vi.useFakeTimers();
      render(<CloudControls {...base} connectionState="reconnecting" />);

      act(() => vi.advanceTimersByTime(2_000));
      expect(screen.getByText('Reconnecting…')).toBeVisible();
      expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    });

    it('marks a lost device connection as disconnected', () => {
      render(<CloudControls {...base} connectionState="offline" />);

      expect(screen.getByText('Disconnected')).toBeVisible();
    });

    it('makes terminal connection failure explicitly retryable', () => {
      const retry = vi.fn();
      render(
        <CloudControls
          {...base}
          connectionState="connection-failed"
          onRetryConnection={retry}
        />,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Disconnected — Retry' }),
      );
      expect(retry).toHaveBeenCalledOnce();
    });
  });

  it('makes failed board-name projection explicit and retryable', () => {
    const retry = vi.fn();
    render(
      <CloudControls
        {...base}
        connectionState="connected"
        onRetryTitle={retry}
        titleState="unavailable"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Board name update failed — Retry' }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it('reports device recovery separately from server durability', () => {
    render(
      <CloudControls
        {...base}
        connectionState="connected"
        deviceRecoveryState="unavailable"
      />,
    );

    expect(screen.getByText('Device recovery unavailable')).toBeVisible();
    expect(screen.getByText('Synced')).toBeVisible();
  });
});
