/**
 * Drives edit activity the way the editor does: as a parent state change rather
 * than a test-issued rerender. A render-phase update satisfies the second and
 * silently misses the first, so this covers the path the application takes.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudControls } from './CloudControls';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Stands in for the workspace: each click publishes a fresh activity identity. */
function EditingParent() {
  const [editActivity, setEditActivity] = useState({});

  return (
    <>
      <button type="button" onClick={() => setEditActivity({})}>
        edit
      </button>
      <CloudControls
        cloudBoardActive
        collaborators={[]}
        connectionState="saved"
        deviceRecoveryState="available"
        editActivity={editActivity}
        onOpenAccount={vi.fn()}
        onShare={vi.fn()}
        shareLabel="Share"
      />
    </>
  );
}

describe('CloudControls activity', () => {
  it('withdraws Synced the instant a parent reports an edit', () => {
    vi.useFakeTimers();
    render(<EditingParent />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText('Synced')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    expect(screen.getByText('Syncing')).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText('Synced')).toBeVisible();
  });
});
