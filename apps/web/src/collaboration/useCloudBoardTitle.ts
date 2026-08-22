/**
 * Debounces a desired cloud title into authorized REST reconciliation. Retries
 * only transient failures, aborts superseded work, and reports unauthorized or
 * exhausted state without changing the Yjs title optimistically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  decodeBoardResponse,
  isApiError,
  isUnavailableError,
  requestApi,
} from '../account/api';
import { normalizedBoardTitle } from '../editor/model/boardTitle';

const CLOUD_TITLE_DEBOUNCE_MS = 500;
const CLOUD_TITLE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

/** Initial save plus the complete bounded transient-failure retry schedule. */
export const MAX_CLOUD_TITLE_RECONCILIATION_ATTEMPTS =
  CLOUD_TITLE_RETRY_DELAYS_MS.length + 1;

/** User-visible state of REST title reconciliation. */
export type CloudBoardTitleState = 'current' | 'saving' | 'unavailable';

interface CloudBoardTitleOptions {
  boardId: string | null;
  canEdit: boolean;
  currentTitle: string;
  desiredTitle: string;
  onReconciled(boardId: string, title: string): void;
  onUnauthorized(): void;
}

function abortableDelay(duration: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    };
    const timeout = window.setTimeout(finish, duration);
    const handleAbort = () => {
      window.clearTimeout(timeout);
      finish();
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function shouldRetry(error: unknown): boolean {
  return (
    isUnavailableError(error) || (isApiError(error) && error.status === 429)
  );
}

/** Reconciles a desired title through authorized REST with abortable retries. */
export function useCloudBoardTitle({
  boardId,
  canEdit,
  currentTitle,
  desiredTitle,
  onReconciled,
  onUnauthorized,
}: CloudBoardTitleOptions): {
  retry(): void;
  state: CloudBoardTitleState;
} {
  const [retryRevision, setRetryRevision] = useState(0);
  const onReconciledRef = useRef(onReconciled);
  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    onReconciledRef.current = onReconciled;
    onUnauthorizedRef.current = onUnauthorized;
  }, [onReconciled, onUnauthorized]);
  const [status, setStatus] = useState<{
    boardId: string | null;
    retryRevision: number;
    state: Exclude<CloudBoardTitleState, 'saving'>;
    title: string;
  }>({ boardId: null, retryRevision: -1, state: 'current', title: '' });
  const normalizedCurrentTitle = normalizedBoardTitle(currentTitle);
  const normalizedDesiredTitle = normalizedBoardTitle(desiredTitle);
  const requiresReconciliation =
    boardId !== null &&
    canEdit &&
    normalizedCurrentTitle !== normalizedDesiredTitle;

  useEffect(() => {
    if (!requiresReconciliation || boardId === null) return;

    const controller = new AbortController();
    const reconcile = async () => {
      await abortableDelay(CLOUD_TITLE_DEBOUNCE_MS, controller.signal);
      for (
        let attempt = 0;
        attempt < MAX_CLOUD_TITLE_RECONCILIATION_ATTEMPTS;
        attempt += 1
      ) {
        if (controller.signal.aborted) return;
        if (attempt > 0) {
          await abortableDelay(
            CLOUD_TITLE_RETRY_DELAYS_MS[attempt - 1] ?? 0,
            controller.signal,
          );
          if (controller.signal.aborted) return;
        }
        try {
          const result = await requestApi(
            `/api/boards/${encodeURIComponent(boardId)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({ title: normalizedDesiredTitle }),
              signal: controller.signal,
            },
            decodeBoardResponse,
          );
          if (controller.signal.aborted) return;
          onReconciledRef.current(result.board.id, result.board.title);
          setStatus({
            boardId,
            retryRevision,
            state: 'current',
            title: result.board.title,
          });
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (isApiError(error) && error.status === 401) {
            onUnauthorizedRef.current();
            setStatus({
              boardId,
              retryRevision,
              state: 'unavailable',
              title: normalizedDesiredTitle,
            });
            return;
          }
          if (
            !shouldRetry(error) ||
            attempt === MAX_CLOUD_TITLE_RECONCILIATION_ATTEMPTS - 1
          ) {
            setStatus({
              boardId,
              retryRevision,
              state: 'unavailable',
              title: normalizedDesiredTitle,
            });
            return;
          }
        }
      }
    };
    void reconcile();
    return () => controller.abort();
  }, [
    boardId,
    canEdit,
    normalizedCurrentTitle,
    normalizedDesiredTitle,
    requiresReconciliation,
    retryRevision,
  ]);

  const retry = useCallback(() => {
    setRetryRevision((current) => current + 1);
  }, []);
  const state = !requiresReconciliation
    ? 'current'
    : status.boardId === boardId &&
        status.retryRevision === retryRevision &&
        status.title === normalizedDesiredTitle
      ? status.state
      : 'saving';
  return { retry, state };
}
