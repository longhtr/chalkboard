/**
 * Exercises board-library selection, rename, duplicate, copy, trash, restore,
 * permanent deletion, announcements, confirmation, and failure presentation.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../test/assertions';
import { LocalBoardLibrary } from './LocalBoardLibrary';

const boards = [
  {
    createdAt: 1,
    id: 'local-one',
    title: 'First board',
    updatedAt: 2,
  },
  {
    createdAt: 3,
    id: 'local-two',
    title: 'Second board',
    updatedAt: 4,
  },
];

const trashedBoards = [
  {
    createdAt: 5,
    id: 'local-trashed',
    title: 'Recoverable board',
    trashedAt: 7,
    updatedAt: 7,
  },
];

const callbacks = {
  onClose: vi.fn(),
  onCopyCloudToLocal: vi.fn(async () =>
    requiredTestValue(boards[0], 'first board fixture'),
  ),
  onCopyLocalToCloud: vi.fn(async () => ({
    id: 'cloud-copy',
    role: 'owner' as const,
    title: 'Cloud copy',
    updatedAt: new Date(0).toISOString(),
  })),
  onDeleteAllCloudPermanently: vi.fn(async () => undefined),
  onDeleteAllPermanently: vi.fn(async () => undefined),
  onDeleteCloudPermanently: vi.fn(async () => undefined),
  onDeletePermanently: vi.fn(async () => undefined),
  onDuplicate: vi.fn(async () => undefined),
  onOpen: vi.fn(),
  onOpenCloud: vi.fn(),
  onRename: vi.fn(async () => undefined),
  onRestore: vi.fn(async () => undefined),
  onRestoreAll: vi.fn(async () => undefined),
  onRestoreAllCloud: vi.fn(async () => undefined),
  onRestoreCloud: vi.fn(async () => undefined),
  onSignIn: vi.fn(),
  onTrash: vi.fn(async () => undefined),
  onTrashCloud: vi.fn(async () => undefined),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LocalBoardLibrary', () => {
  it('opens, renames, duplicates, and immediately manages trash', async () => {
    render(
      <LocalBoardLibrary
        boards={boards}
        cloudBoards={[]}
        cloudBoardsState="signed-out"
        currentBoardId="local-one"
        currentCloudBoardId={null}
        signedIn={false}
        trashedBoards={trashedBoards}
        trashedCloudBoards={[]}
        {...callbacks}
      />,
    );

    expect(screen.queryByLabelText('New board')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'On this device' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'On the cloud' })).toBeVisible();
    expect(screen.getByText('You are not signed in.')).toBeVisible();
    expect(
      screen.queryByText('Local boards stay in this browser.'),
    ).not.toBeInTheDocument();

    const secondBoardButton = screen.getByRole('button', {
      name: 'Open Second board',
    });
    expect(
      secondBoardButton.querySelector('.local-board-library__summary'),
    ).toBeInTheDocument();
    expect(
      secondBoardButton.querySelector('.local-board-library__current'),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: 'Open First board' })
        .querySelector('.local-board-library__current'),
    ).toHaveTextContent('Open');
    fireEvent.click(secondBoardButton);
    expect(callbacks.onOpen).toHaveBeenCalledWith('local-two');

    const firstEntry = requiredTestValue(
      screen.getByRole('button', { name: 'Open First board' }).closest('li'),
      'first board list entry',
    );
    const renameButton = requiredTestValue(
      firstEntry.querySelectorAll<HTMLButtonElement>('button')[1],
      'first board rename button',
    );
    fireEvent.click(renameButton);
    const rename = screen.getByRole('textbox', {
      name: 'Rename First board',
    });
    fireEvent.change(rename, { target: { value: 'Renamed board' } });
    fireEvent.submit(requiredTestValue(rename.closest('form'), 'rename form'));
    expect(callbacks.onRename).toHaveBeenCalledWith(
      'local-one',
      'Renamed board',
    );
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Rename First board' }),
      ).not.toBeInTheDocument(),
    );

    const secondEntry = requiredTestValue(
      screen.getByRole('button', { name: 'Open Second board' }).closest('li'),
      'second board list entry',
    );
    const actions = secondEntry.querySelectorAll<HTMLButtonElement>('button');
    fireEvent.click(
      requiredTestValue(actions[2], 'second board duplicate button'),
    );
    expect(callbacks.onDuplicate).toHaveBeenCalledWith('local-two');
    const trashButton = requiredTestValue(
      actions[3],
      'second board trash button',
    );
    await vi.waitFor(() => expect(trashButton).toBeEnabled());
    fireEvent.click(trashButton);
    expect(callbacks.onTrash).toHaveBeenCalledWith('local-two');
    expect(
      screen.queryByText('Move Second board to trash?'),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('list', { name: 'Device trash' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Device trash (1)' }));
    const trash = screen.getByRole('list', { name: 'Device trash' });
    const restore = within(trash).getByRole('button', { name: 'Restore' });
    await vi.waitFor(() => expect(restore).toBeEnabled());
    fireEvent.click(restore);
    expect(callbacks.onRestore).toHaveBeenCalledWith('local-trashed');
    await vi.waitFor(() =>
      expect(
        within(trash).getByRole('button', { name: 'Delete permanently' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(trash).getByRole('button', { name: 'Delete permanently' }),
    );
    expect(callbacks.onDeletePermanently).toHaveBeenCalledWith('local-trashed');
    expect(
      screen.queryByText(/Permanently delete Recoverable board/u),
    ).not.toBeInTheDocument();

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore all' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore all' }));
    expect(callbacks.onRestoreAll).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Empty trash' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    expect(callbacks.onDeleteAllPermanently).toHaveBeenCalledOnce();
  });

  it('copies boards between local and cloud sections when signed in', async () => {
    const cloudBoard = {
      id: 'cloud-one',
      role: 'owner' as const,
      title: 'Cloud board',
      updatedAt: new Date(8).toISOString(),
    };
    render(
      <LocalBoardLibrary
        boards={boards}
        cloudBoards={[cloudBoard]}
        cloudBoardsState="ready"
        currentBoardId="local-one"
        currentCloudBoardId={null}
        signedIn
        trashedBoards={[]}
        trashedCloudBoards={[
          {
            deletedAt: new Date(9).toISOString(),
            id: 'cloud-trashed',
            title: 'Cloud trashed board',
          },
        ]}
        {...callbacks}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Device trash' }));
    expect(screen.getByText('Trash is empty.')).toBeVisible();
    expect(screen.queryByText('Kept for 30 days')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← Back to boards' }));

    const localList = screen.getByRole('list', { name: 'On this device' });
    fireEvent.click(
      requiredTestValue(
        within(localList).getAllByRole('button', { name: 'Copy to cloud' })[0],
        'first copy-to-cloud button',
      ),
    );
    expect(callbacks.onCopyLocalToCloud).toHaveBeenCalledWith('local-one');

    await vi.waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copy to local' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy to local' }));
    expect(callbacks.onCopyCloudToLocal).toHaveBeenCalledWith('cloud-one');
    fireEvent.click(
      screen.getByRole('button', { name: 'Open cloud board Cloud board' }),
    );
    expect(callbacks.onOpenCloud).toHaveBeenCalledWith(cloudBoard);

    fireEvent.click(screen.getByRole('button', { name: 'Cloud trash (1)' }));
    expect(screen.getByRole('list', { name: 'Cloud trash' })).toBeVisible();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await vi.waitFor(() =>
      expect(callbacks.onRestoreCloud).toHaveBeenCalledWith('cloud-trashed'),
    );
  });
});
