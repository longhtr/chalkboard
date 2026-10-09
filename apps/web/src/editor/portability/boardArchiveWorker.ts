/** Worker entry that isolates hostile archive parsing and transfers validated bytes back without copying. */
import { parseBoardArchive, type ParsedBoardArchive } from './boardArchive';

interface ParseRequest {
  bytes: ArrayBuffer;
}

type ParseResponse =
  { archive: ParsedBoardArchive; ok: true } | { error: string; ok: false };

// The application tsconfig targets DOM rather than WebWorker globals; keep the
// worker-only surface explicit instead of widening every browser module's libs.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: ParseResponse): void;
};

workerScope.onmessage = (event) => {
  void parseBoardArchive(new Uint8Array(event.data.bytes))
    .then((archive) => workerScope.postMessage({ archive, ok: true }))
    .catch((error: unknown) =>
      workerScope.postMessage({
        error:
          error instanceof Error
            ? error.message
            : 'Editable board validation failed',
        ok: false,
      }),
    );
};
