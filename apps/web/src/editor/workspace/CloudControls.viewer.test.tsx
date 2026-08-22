/**
 * Locks a viewer's two facts to two separate badges. Nothing a viewer does
 * would reveal a dead socket — they make no edits that fail to save — so the
 * board would simply stop changing with no explanation. Their role must not
 * occupy the slot that reports it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudConnectionState } from '../../collaboration/useCloudBoard';
import { CloudControls } from './CloudControls';

afterEach(cleanup);

function renderViewer(connectionState: CloudConnectionState, viewer = true) {
  render(
    <CloudControls
      cloudBoardActive
      collaborators={[]}
      connectionState={connectionState}
      deviceRecoveryState="available"
      onOpenAccount={vi.fn()}
      onShare={vi.fn()}
      shareLabel="Share"
      viewerRole={viewer}
    />,
  );
}

describe('CloudControls viewer badges', () => {
  it('reports the role and the transport at the same time', () => {
    renderViewer('read-only');

    expect(screen.getByText('View only')).toBeVisible();
    expect(screen.getByText('Connected')).toBeVisible();
  });

  it('keeps the role on screen while the connection drops', () => {
    renderViewer('offline');

    expect(screen.getByText('View only')).toBeVisible();
    expect(screen.getByText('Disconnected')).toBeVisible();
  });

  it('keeps the role beside the retry control', () => {
    renderViewer('connection-failed');

    expect(screen.getByText('View only')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Disconnected — Retry' }),
    ).toBeVisible();
  });

  // Durability is a promise about work you did. A viewer never has any, so a
  // permanently green badge would say nothing.
  it('claims nothing about durability', () => {
    renderViewer('read-only');

    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('leaves an editor with no role pill', () => {
    renderViewer('connected', false);

    expect(screen.queryByText('View only')).not.toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeVisible();
  });

  it('shows a local board its own pill and no transport', () => {
    renderViewer('local', false);

    expect(screen.getByText('Local')).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });
});
