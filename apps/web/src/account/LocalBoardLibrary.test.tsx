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
  onDuplicateCloud: vi.fn(async () => undefined),
  onLeaveCloud: vi.fn(async () => undefined),
  onOpen: vi.fn(),
  onOpenCloud: vi.fn(),
  onRename: vi.fn(async () => undefined),
  onRenameCloud: vi.fn(async () => undefined),
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
    // The open board is shown by the highlighted row, not by a badge repeating
    // it inside the row.
    expect(secondBoardButton.closest('li')).not.toHaveClass('is-current');
    expect(
      screen.getByRole('button', { name: 'Open First board' }).closest('li'),
    ).toHaveClass('is-current');
    fireEvent.click(secondBoardButton);
    expect(callbacks.onOpen).toHaveBeenCalledWith('local-two');

    const firstEntry = requiredTestValue(
      screen.getByRole('button', { name: 'Open First board' }).closest('li'),
      'first board list entry',
    );
    fireEvent.click(within(firstEntry).getByRole('button', { name: 'Rename' }));
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
    // Located by name: the action row's order is not part of the contract.
    fireEvent.click(
      within(secondEntry).getByRole('button', { name: 'Duplicate' }),
    );
    expect(callbacks.onDuplicate).toHaveBeenCalledWith('local-two');
    const trashButton = within(secondEntry).getByRole('button', {
      name: 'Trash',
    });
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

  it('allows the last local board to be trashed so the app can replace it', () => {
    const onlyBoard = requiredTestValue(boards[0], 'only board fixture');
    render(
      <LocalBoardLibrary
        boards={[onlyBoard]}
        cloudBoards={[]}
        cloudBoardsState="signed-out"
        currentBoardId={onlyBoard.id}
        currentCloudBoardId={null}
        signedIn={false}
        trashedBoards={[]}
        trashedCloudBoards={[]}
        {...callbacks}
      />,
    );

    const trash = screen.getByRole('button', { name: 'Trash' });
    expect(trash).toBeEnabled();
    fireEvent.click(trash);
    expect(callbacks.onTrash).toHaveBeenCalledWith(onlyBoard.id);
  });

  it.each([
    ['owner', true],
    ['editor', true],
    ['viewer', false],
  ] as const)('offers a %s rename on a cloud board: %s', (role, offered) => {
    render(
      <LocalBoardLibrary
        boards={[]}
        cloudBoards={[
          {
            id: 'cloud-one',
            role,
            title: 'Cloud board',
            updatedAt: new Date(8).toISOString(),
          },
        ]}
        cloudBoardsState="ready"
        currentBoardId=""
        currentCloudBoardId={null}
        signedIn
        trashedBoards={[]}
        trashedCloudBoards={[]}
        {...callbacks}
      />,
    );

    const cloudList = screen.getByRole('list', { name: 'On the cloud' });
    const rename = within(cloudList).queryByRole('button', { name: 'Rename' });
    if (!offered) {
      // A viewer's rename would be refused by the server anyway; offering it
      // would only promise something the board will not do.
      expect(rename).not.toBeInTheDocument();
      return;
    }

    fireEvent.click(requiredTestValue(rename, 'cloud rename button'));
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Rename Cloud board' }),
      { target: { value: 'Renamed in the cloud' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(callbacks.onRenameCloud).toHaveBeenCalledWith(
      'cloud-one',
      'Renamed in the cloud',
    );
  });

  it('offers a duplicate on a cloud board whatever the role', () => {
    render(
      <LocalBoardLibrary
        boards={[]}
        cloudBoards={[
          {
            id: 'cloud-one',
            role: 'viewer',
            title: 'Cloud board',
            updatedAt: new Date(8).toISOString(),
          },
        ]}
        cloudBoardsState="ready"
        currentBoardId=""
        currentCloudBoardId={null}
        signedIn
        trashedBoards={[]}
        trashedCloudBoards={[]}
        {...callbacks}
      />,
    );

    const cloudList = screen.getByRole('list', { name: 'On the cloud' });
    // A viewer may not rename, but taking a copy is theirs to do: they could
    // already reach one through local storage in two steps.
    expect(
      within(cloudList).queryByRole('button', { name: 'Rename' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(cloudList).getByRole('button', { name: 'Duplicate' }),
    );

    expect(callbacks.onDuplicateCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cloud-one' }),
    );
  });

  it('offers leaving rather than trashing a board owned by somebody else', () => {
    render(
      <LocalBoardLibrary
        boards={[]}
        cloudBoards={[
          {
            id: 'cloud-one',
            role: 'editor',
            title: 'Cloud board',
            updatedAt: new Date(8).toISOString(),
          },
        ]}
        cloudBoardsState="ready"
        currentBoardId=""
        currentCloudBoardId={null}
        signedIn
        trashedBoards={[]}
        trashedCloudBoards={[]}
        {...callbacks}
      />,
    );

    const cloudList = screen.getByRole('list', { name: 'On the cloud' });
    // Offering Trash here would promise a removal the server refuses: the
    // board is not theirs to delete, only to stop being a member of.
    expect(
      within(cloudList).queryByRole('button', { name: 'Trash' }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(cloudList).getByRole('button', { name: 'Leave' }));
    expect(callbacks.onLeaveCloud).toHaveBeenCalledWith('cloud-one');
  });

  it('filters both sections from one query', () => {
    render(
      <LocalBoardLibrary
        boards={boards}
        cloudBoards={[
          {
            id: 'cloud-notes',
            role: 'owner',
            title: 'Cloud lecture notes',
            updatedAt: new Date(8).toISOString(),
          },
          {
            id: 'cloud-other',
            role: 'owner',
            title: 'Unrelated cloud board',
            updatedAt: new Date(9).toISOString(),
          },
        ]}
        cloudBoardsState="ready"
        currentBoardId="local-one"
        currentCloudBoardId={null}
        signedIn
        trashedBoards={[]}
        trashedCloudBoards={[]}
        {...callbacks}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Search boards' });
    fireEvent.change(search, { target: { value: 'cloud lecture' } });

    const cloudList = screen.getByRole('list', { name: 'On the cloud' });
    expect(
      within(cloudList).getAllByRole('button', { name: /^Open cloud board/u }),
    ).toHaveLength(1);
    // Terms match in any order and across the whole title.
    expect(
      within(cloudList).getByRole('button', {
        name: 'Open cloud board Cloud lecture notes',
      }),
    ).toBeVisible();
    // The device section is filtered by the same query, and says so rather
    // than looking empty for no reason.
    expect(
      screen.getByText('No device boards match your search.'),
    ).toBeVisible();
    expect(screen.getByText(/1 of 4 boards shown/u)).toBeVisible();
  });

  it('reports a cloud section emptied by the search apart from having none', () => {
    render(
      <LocalBoardLibrary
        boards={[]}
        cloudBoards={[
          {
            id: 'cloud-one',
            role: 'owner',
            title: 'Cloud board',
            updatedAt: new Date(8).toISOString(),
          },
        ]}
        cloudBoardsState="ready"
        currentBoardId=""
        currentCloudBoardId={null}
        signedIn
        trashedBoards={[]}
        trashedCloudBoards={[]}
        {...callbacks}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search boards' }), {
      target: { value: 'nothing here' },
    });

    expect(
      screen.getByText('No cloud boards match your search.'),
    ).toBeVisible();
    expect(screen.queryByText('No cloud boards yet.')).not.toBeInTheDocument();
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
