/**
 * Uses fake time and controlled responses to prove title debounce, retry,
 * cancellation, reconciliation, authorization expiry, and manual retry.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, decodeBoardResponse, requestApi } from '../account/api';
import { requiredTestValue } from '../test/assertions';
import {
  MAX_CLOUD_TITLE_RECONCILIATION_ATTEMPTS,
  useCloudBoardTitle,
} from './useCloudBoardTitle';

vi.mock('../account/api', async (importActual) => {
  const actual = await importActual<typeof import('../account/api')>();
  return { ...actual, requestApi: vi.fn() };
});

const requestApiMock = vi.mocked(requestApi);

interface HarnessProps {
  boardId?: string | null;
  canEdit?: boolean;
  currentTitle?: string;
  desiredTitle?: string;
  onReconciled?: (boardId: string, title: string) => void;
  onUnauthorized?: () => void;
}

function Harness({
  boardId = 'board/id',
  canEdit = true,
  currentTitle = 'Before',
  desiredTitle = 'After',
  onReconciled = () => undefined,
  onUnauthorized = () => undefined,
}: HarnessProps) {
  const { retry, state } = useCloudBoardTitle({
    boardId,
    canEdit,
    currentTitle,
    desiredTitle,
    onReconciled,
    onUnauthorized,
  });
  return (
    <>
      <span role="status">{state}</span>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  requestApiMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('cloud board title reconciliation', () => {
  it('debounces title changes and ignores the stale revision', async () => {
    const reconciled = vi.fn();
    requestApiMock.mockResolvedValue({
      board: { id: 'board/id', title: 'Second' },
    });
    const view = render(
      <Harness desiredTitle="First" onReconciled={reconciled} />,
    );

    await act(() => vi.advanceTimersByTimeAsync(250));
    view.rerender(
      <Harness desiredTitle="  Second  " onReconciled={reconciled} />,
    );
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(requestApiMock).toHaveBeenCalledOnce();
    expect(requestApiMock).toHaveBeenCalledWith(
      '/api/boards/board%2Fid',
      {
        body: JSON.stringify({ title: 'Second' }),
        method: 'PATCH',
        signal: expect.any(AbortSignal),
      },
      decodeBoardResponse,
    );
    expect(reconciled).toHaveBeenCalledWith('board/id', 'Second');
    expect(screen.getByRole('status')).toHaveTextContent('current');
  });

  it('bounds transient retries and supports an explicit retry', async () => {
    requestApiMock.mockRejectedValue(new ApiError('Unavailable', null));
    render(<Harness />);

    await act(() => vi.advanceTimersByTimeAsync(16_000));

    expect(requestApiMock).toHaveBeenCalledTimes(
      MAX_CLOUD_TITLE_RECONCILIATION_ATTEMPTS,
    );
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');

    requestApiMock.mockReset();
    requestApiMock.mockResolvedValue({
      board: { id: 'board/id', title: 'After' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(requestApiMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('current');
  });

  it('does not retry permanent failures or mutate viewer metadata', async () => {
    requestApiMock.mockRejectedValue(new ApiError('Forbidden', 403));
    const view = render(<Harness />);

    await act(() => vi.advanceTimersByTimeAsync(16_000));

    expect(requestApiMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');

    requestApiMock.mockClear();
    view.rerender(<Harness canEdit={false} />);
    await act(() => vi.advanceTimersByTimeAsync(16_000));

    expect(requestApiMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('current');
  });

  it('expires authorization without retrying', async () => {
    const unauthorized = vi.fn();
    requestApiMock.mockRejectedValue(new ApiError('Unauthorized', 401));
    render(<Harness onUnauthorized={unauthorized} />);

    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(requestApiMock).toHaveBeenCalledOnce();
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
  });

  it('aborts an in-flight request on teardown', async () => {
    let requestSignal: AbortSignal | undefined;
    requestApiMock.mockImplementation((_url, options) => {
      requestSignal = options?.signal ?? undefined;
      return new Promise(() => undefined);
    });
    const view = render(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(500));

    const activeRequestSignal = requiredTestValue(
      requestSignal,
      'active title request signal',
    );
    expect(activeRequestSignal.aborted).toBe(false);
    view.unmount();

    expect(activeRequestSignal.aborted).toBe(true);
  });
});
