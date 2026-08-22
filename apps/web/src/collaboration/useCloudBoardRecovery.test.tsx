/**
 * Seeds cloud cache states to prove startup recovery, pending snapshot/update
 * replay, incompatible records, age/size limits, and explicit retry behavior.
 */
import type { BoardElement } from '@chalkboard/shared';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../test/assertions';

const storageMocks = vi.hoisted(() => ({
  loadCloudBoardCache: vi.fn(),
  saveCloudBoardCache: vi.fn(),
}));

vi.mock('../editor/local/boardStorage', () => storageMocks);

import {
  MAX_PENDING_CLOUD_UPDATE_AGE_MS,
  PreservedCloudRecoveryError,
} from '../editor/cloud/cloudBoardCacheQueue';
import { writeCloudBoard } from './cloudBoardModel';
import * as cloudReconnect from './cloudReconnect';
import { useCloudBoard } from './useCloudBoard';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static readonly CLOSED = 3;
  static readonly CLOSING = 2;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  binaryType: BinaryType = 'blob';
  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];

  constructor() {
    super();
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  send(value: unknown) {
    this.sent.push(value);
  }
}

const rectangle: BoardElement = {
  backgroundColor: 'transparent',
  cornerRadius: 0,
  createdBy: 'test',
  height: 80,
  id: 'rectangle',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  strokeColor: '#111827',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'shape',
  width: 120,
  x: 10,
  y: 20,
};

function Harness({ elements }: { elements: BoardElement[] }) {
  const cloud = useCloudBoard({
    boardId: 'board-id',
    canEdit: true,
    elements,
    onRemoteBoard: vi.fn(),
    title: 'Cloud board',
    user: null,
  });
  return (
    <>
      <output data-testid="cloud-state">
        {cloud.state}:{cloud.deviceRecoveryState}
      </output>
      <button type="button" onClick={cloud.retryConnection}>
        Retry connection
      </button>
    </>
  );
}

describe('cloud device recovery status', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    storageMocks.loadCloudBoardCache.mockReset();
    storageMocks.saveCloudBoardCache.mockReset();
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('closes a connection attempt that never synchronizes', async () => {
    vi.useFakeTimers();
    storageMocks.loadCloudBoardCache.mockResolvedValue(null);
    storageMocks.saveCloudBoardCache.mockResolvedValue(undefined);
    render(<Harness elements={[rectangle]} />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = requiredTestValue(
      FakeWebSocket.instances[0],
      'first recovery WebSocket',
    );
    const close = vi.spyOn(socket, 'close');

    await act(async () =>
      vi.advanceTimersByTimeAsync(
        cloudReconnect.CLOUD_CONNECTION_ATTEMPT_TIMEOUT_MS - 1,
      ),
    );
    expect(close).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(close).toHaveBeenCalledOnce();
  });

  it('stops reconnecting at the limit, retains edits, and permits explicit retry', async () => {
    vi.spyOn(cloudReconnect, 'cloudReconnectDelay').mockImplementation(
      (attempt) =>
        attempt <= cloudReconnect.MAX_CLOUD_RECONNECT_ATTEMPTS ? 0 : null,
    );
    storageMocks.loadCloudBoardCache.mockResolvedValue(null);
    storageMocks.saveCloudBoardCache.mockResolvedValue(undefined);
    const view = render(<Harness elements={[rectangle]} />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    for (
      let attempt = 1;
      attempt <= cloudReconnect.MAX_CLOUD_RECONNECT_ATTEMPTS;
      attempt += 1
    ) {
      const socket = requiredTestValue(
        FakeWebSocket.instances.at(-1),
        'latest recovery WebSocket',
      );
      socket.readyState = FakeWebSocket.CLOSED;
      socket.dispatchEvent(new Event('close'));
      await waitFor(() =>
        expect(FakeWebSocket.instances).toHaveLength(attempt + 1),
      );
    }
    const finalAutomaticSocket = requiredTestValue(
      FakeWebSocket.instances.at(-1),
      'final automatic recovery WebSocket',
    );
    finalAutomaticSocket.readyState = FakeWebSocket.CLOSED;
    finalAutomaticSocket.dispatchEvent(new Event('close'));
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'connection-failed:available',
      ),
    );
    expect(cloudReconnect.cloudReconnectDelay).toHaveBeenLastCalledWith(
      cloudReconnect.MAX_CLOUD_RECONNECT_ATTEMPTS + 1,
    );

    view.rerender(<Harness elements={[{ ...rectangle, x: 40 }]} />);
    await waitFor(() =>
      expect(storageMocks.saveCloudBoardCache).toHaveBeenCalledWith(
        'board-id',
        expect.objectContaining({
          elements: [{ ...rectangle, x: 40 }],
          pending: true,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    await waitFor(() =>
      expect(FakeWebSocket.instances).toHaveLength(
        cloudReconnect.MAX_CLOUD_RECONNECT_ATTEMPTS + 2,
      ),
    );
    expect(screen.getByTestId('cloud-state')).toHaveTextContent(
      'reconnecting:available',
    );
  });

  it('preserves an unreadable recovery queue while continuing to connect', async () => {
    storageMocks.loadCloudBoardCache.mockRejectedValue(
      new PreservedCloudRecoveryError('Recovery limit exceeded'),
    );

    const view = render(<Harness elements={[rectangle]} />);
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'connecting:unavailable',
      ),
    );

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    window.dispatchEvent(new Event('offline'));
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'offline:unavailable',
      ),
    );
    view.rerender(<Harness elements={[{ ...rectangle, x: 40 }]} />);
    expect(storageMocks.saveCloudBoardCache).not.toHaveBeenCalled();
  });

  it('converts expired raw recovery to a snapshot and durably reconciles it', async () => {
    const pendingSince = Date.now() - MAX_PENDING_CLOUD_UPDATE_AGE_MS - 1;
    storageMocks.loadCloudBoardCache.mockResolvedValue({
      baselineElements: [],
      baselineTitle: 'Cloud board',
      elements: [rectangle],
      pending: true,
      pendingSince,
      pendingUpdates: [new Uint8Array([1])],
      title: 'Cloud board',
      updatedAt: pendingSince,
    });
    storageMocks.saveCloudBoardCache.mockResolvedValue(undefined);
    render(<Harness elements={[rectangle]} />);

    await waitFor(() =>
      expect(storageMocks.saveCloudBoardCache).toHaveBeenCalledWith(
        'board-id',
        expect.objectContaining({
          elements: [rectangle],
          pending: true,
          pendingSince,
          pendingUpdates: [],
        }),
      ),
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = requiredTestValue(
      FakeWebSocket.instances[0],
      'first recovery WebSocket',
    );
    socket.readyState = FakeWebSocket.OPEN;
    const serverDocument = new Y.Doc();
    writeCloudBoard(serverDocument, [], 'Cloud board');
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, 0);
    syncProtocol.writeUpdate(sync, Y.encodeStateAsUpdate(serverDocument));
    const syncMessage = encoding.toUint8Array(sync);
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: syncMessage.buffer.slice(
          syncMessage.byteOffset,
          syncMessage.byteOffset + syncMessage.byteLength,
        ),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'syncing:available',
      ),
    );
    const acknowledgement = encoding.createEncoder();
    encoding.writeVarUint(acknowledgement, 2);
    encoding.writeVarUint(acknowledgement, 1);
    const acknowledgementMessage = encoding.toUint8Array(acknowledgement);
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: acknowledgementMessage.buffer.slice(
          acknowledgementMessage.byteOffset,
          acknowledgementMessage.byteOffset + acknowledgementMessage.byteLength,
        ),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'saved:available',
      ),
    );
    await waitFor(() =>
      expect(storageMocks.saveCloudBoardCache).toHaveBeenCalledWith(
        'board-id',
        expect.objectContaining({
          elements: [rectangle],
          pending: false,
          pendingUpdates: [],
        }),
      ),
    );
    serverDocument.destroy();
  });

  it('clears snapshot recovery when server sync already proves it durable', async () => {
    storageMocks.loadCloudBoardCache.mockResolvedValue({
      baselineElements: [],
      baselineTitle: 'Cloud board',
      elements: [rectangle],
      pending: true,
      pendingUpdates: [],
      title: 'Cloud board',
      updatedAt: 1,
    });
    storageMocks.saveCloudBoardCache.mockResolvedValue(undefined);
    render(<Harness elements={[rectangle]} />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = requiredTestValue(
      FakeWebSocket.instances[0],
      'first recovery WebSocket',
    );
    socket.readyState = FakeWebSocket.OPEN;
    const serverDocument = new Y.Doc();
    writeCloudBoard(serverDocument, [rectangle], 'Cloud board');
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, 0);
    syncProtocol.writeUpdate(sync, Y.encodeStateAsUpdate(serverDocument));
    const message = encoding.toUint8Array(sync);

    socket.dispatchEvent(
      new MessageEvent('message', {
        data: message.buffer.slice(
          message.byteOffset,
          message.byteOffset + message.byteLength,
        ),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'saved:available',
      ),
    );
    await waitFor(() =>
      expect(storageMocks.saveCloudBoardCache).toHaveBeenCalledWith(
        'board-id',
        expect.objectContaining({
          elements: [rectangle],
          pending: false,
          pendingUpdates: [],
        }),
      ),
    );
    serverDocument.destroy();
  });

  it('reports a recoverable drop as reconnecting rather than a disconnection', async () => {
    vi.spyOn(cloudReconnect, 'cloudReconnectDelay').mockReturnValue(50_000);
    storageMocks.loadCloudBoardCache.mockResolvedValue(null);
    storageMocks.saveCloudBoardCache.mockResolvedValue(undefined);
    render(<Harness elements={[rectangle]} />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = requiredTestValue(
      FakeWebSocket.instances[0],
      'first recovery WebSocket',
    );

    socket.readyState = FakeWebSocket.CLOSED;
    socket.dispatchEvent(new Event('close'));

    // `offline` claims the device lost connectivity; a retryable drop must not.
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'reconnecting:available',
      ),
    );
  });

  it('reports a device that is genuinely offline as offline', async () => {
    storageMocks.loadCloudBoardCache.mockResolvedValue(null);
    storageMocks.saveCloudBoardCache.mockResolvedValue(undefined);
    render(<Harness elements={[rectangle]} />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = requiredTestValue(
      FakeWebSocket.instances[0],
      'first recovery WebSocket',
    );

    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    socket.readyState = FakeWebSocket.CLOSED;
    socket.dispatchEvent(new Event('close'));

    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'offline:available',
      ),
    );
  });

  it('ignores queued socket events after the connection is disposed', async () => {
    storageMocks.loadCloudBoardCache.mockResolvedValue(null);
    const view = render(<Harness elements={[rectangle]} />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = requiredTestValue(
      FakeWebSocket.instances[0],
      'first recovery WebSocket',
    );
    view.unmount();

    socket.dispatchEvent(new Event('open'));
    const acknowledgement = encoding.createEncoder();
    encoding.writeVarUint(acknowledgement, 2);
    encoding.writeVarUint(acknowledgement, 1);
    const message = encoding.toUint8Array(acknowledgement);
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: message.buffer.slice(
          message.byteOffset,
          message.byteOffset + message.byteLength,
        ),
      }),
    );

    expect(socket.sent).toEqual([]);
    expect(storageMocks.saveCloudBoardCache).not.toHaveBeenCalled();
  });

  it('exposes an offline cache-write failure and clears it after recovery', async () => {
    storageMocks.loadCloudBoardCache.mockResolvedValue(null);
    storageMocks.saveCloudBoardCache
      .mockRejectedValueOnce(new DOMException('Quota', 'QuotaExceededError'))
      .mockResolvedValueOnce(undefined);
    const view = render(<Harness elements={[rectangle]} />);
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'connecting:available',
      ),
    );

    // A browser offline event drives the existing unsynchronized cache path.
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    window.dispatchEvent(new Event('offline'));
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent('offline'),
    );
    view.rerender(<Harness elements={[{ ...rectangle, x: 40 }]} />);
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'offline:unavailable',
      ),
    );

    view.rerender(<Harness elements={[{ ...rectangle, x: 80 }]} />);
    await waitFor(() =>
      expect(screen.getByTestId('cloud-state')).toHaveTextContent(
        'offline:available',
      ),
    );
  });
});
