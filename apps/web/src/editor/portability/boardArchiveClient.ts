/** Cancellable main-thread interface to archive parsing, using a worker when available and safe fallback otherwise. */
import type { ParsedBoardArchive } from './boardArchive';

const WORKER_TIMEOUT_MS = 120_000;

type WorkerResponse =
  { archive: ParsedBoardArchive; ok: true } | { error: string; ok: false };

function cancellationError(): DOMException {
  return new DOMException('Editable board import was cancelled', 'AbortError');
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw cancellationError();
}

/** Parses hostile archive bytes in a worker, with an equivalent direct test fallback. */
export async function parseBoardArchiveIsolated(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<ParsedBoardArchive> {
  throwIfCancelled(signal);
  if (typeof Worker === 'undefined') {
    const { parseBoardArchive } = await import('./boardArchive');
    const archive = await parseBoardArchive(bytes);
    throwIfCancelled(signal);
    return archive;
  }

  const worker = new Worker(
    new URL('./boardArchiveWorker.ts', import.meta.url),
    {
      name: 'chalkboard-archive-validator',
      type: 'module',
    },
  );
  const copied = new Uint8Array(bytes);
  return new Promise<ParsedBoardArchive>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error('Editable board validation timed out'));
    }, WORKER_TIMEOUT_MS);
    const finish = () => {
      if (settled) return false;
      settled = true;
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      return true;
    };
    const cancel = () => {
      if (finish()) reject(cancellationError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.addEventListener(
      'message',
      (event: MessageEvent<WorkerResponse>) => {
        if (!finish()) return;
        if (event.data.ok) resolve(event.data.archive);
        else reject(new Error(event.data.error));
      },
    );
    worker.addEventListener('error', () => {
      if (finish())
        reject(new Error('Editable board validation worker failed'));
    });
    worker.postMessage({ bytes: copied.buffer }, [copied.buffer]);
  });
}
