/** Parses and constructs canonical local and cloud board paths without reading storage or authorization. */
type BoardRoute =
  | { kind: 'default' }
  | { boardId: string | null; kind: 'local' }
  | { boardId: string; kind: 'cloud' };

function decodedBoardId(pattern: RegExp, pathname: string): string | null {
  const encodedBoardId = pattern.exec(pathname)?.[1];
  if (encodedBoardId === undefined) return null;
  try {
    const boardId = decodeURIComponent(encodedBoardId);
    return boardId === '' ? null : boardId;
  } catch {
    return null;
  }
}

/** Parses only canonical local/cloud board paths; all other paths are unselected. */
export function readBoardRoute(pathname: string): BoardRoute {
  if (pathname === '/local' || pathname === '/local/') {
    return { boardId: null, kind: 'local' };
  }
  const localBoardId = decodedBoardId(/^\/local\/([^/]+)\/?$/u, pathname);
  if (localBoardId !== null) {
    return { boardId: localBoardId, kind: 'local' };
  }
  const cloudBoardId = decodedBoardId(/^\/boards\/([^/]+)\/?$/u, pathname);
  if (cloudBoardId !== null) {
    return { boardId: cloudBoardId, kind: 'cloud' };
  }
  return { kind: 'default' };
}

/** Reports whether a path identifies one concrete local or cloud board. */
export function isBoardSpecificPath(pathname: string): boolean {
  const route = readBoardRoute(pathname);
  return (
    route.kind === 'cloud' || (route.kind === 'local' && route.boardId !== null)
  );
}

/** Builds the percent-encoded canonical route for a cloud board. */
export function boardPath(boardId: string): string {
  return `/boards/${encodeURIComponent(boardId)}`;
}

/** Builds the percent-encoded canonical route for a local board. */
export function localBoardPath(boardId: string): string {
  return `/local/${encodeURIComponent(boardId)}`;
}
