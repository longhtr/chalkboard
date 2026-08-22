/**
 * Locks the participant list to one avatar per account. Yjs Awareness issues a
 * fresh client id per tab, so without grouping, one person with two tabs open
 * appears twice to everyone on the board.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudCollaborator } from '../../collaboration/useCloudBoard';
import { CloudControls } from './CloudControls';

afterEach(cleanup);

function presence(
  clientId: number,
  name: string,
  userId: string | null,
): CloudCollaborator {
  return { clientId, color: 'hsl(200 62% 52%)', name, selection: [], userId };
}

function renderWith(collaborators: CloudCollaborator[]) {
  render(
    <CloudControls
      cloudBoardActive
      collaborators={collaborators}
      connectionState="connected"
      deviceRecoveryState="available"
      onOpenAccount={vi.fn()}
      onShare={vi.fn()}
      shareLabel="Share"
    />,
  );
}

function avatarNames(): string[] {
  return screen
    .queryAllByLabelText(/is collaborating$/u)
    .map((element) => element.getAttribute('aria-label') ?? '');
}

describe('CloudControls participant list', () => {
  it('shows one avatar when a single account has several tabs open', () => {
    renderWith([
      presence(1, 'Ada', 'user-ada'),
      presence(2, 'Ada', 'user-ada'),
      presence(3, 'Ada', 'user-ada'),
    ]);

    expect(avatarNames()).toEqual(['Ada is collaborating']);
  });

  it('keeps distinct accounts distinct', () => {
    renderWith([
      presence(1, 'Ada', 'user-ada'),
      presence(2, 'Grace', 'user-grace'),
    ]);

    expect(avatarNames()).toEqual([
      'Ada is collaborating',
      'Grace is collaborating',
    ]);
  });

  it('lists peers that publish no account identifier rather than hiding them', () => {
    renderWith([presence(1, 'Ada', null), presence(2, 'Ada', null)]);

    expect(avatarNames()).toHaveLength(2);
  });

  it('counts overflow by account, not by tab', () => {
    renderWith([
      presence(1, 'Ada', 'user-ada'),
      presence(2, 'Ada', 'user-ada'),
      presence(3, 'Ada', 'user-ada'),
      presence(4, 'Ada', 'user-ada'),
    ]);

    expect(avatarNames()).toHaveLength(1);
    expect(screen.queryByText(/^\+\d+$/u)).not.toBeInTheDocument();
  });

  it('still overflows past three distinct accounts', () => {
    renderWith([
      presence(1, 'Ada', 'user-ada'),
      presence(2, 'Grace', 'user-grace'),
      presence(3, 'Alan', 'user-alan'),
      presence(4, 'Edsger', 'user-edsger'),
    ]);

    expect(avatarNames()).toHaveLength(3);
    expect(screen.getByText('+1')).toBeVisible();
  });
});
