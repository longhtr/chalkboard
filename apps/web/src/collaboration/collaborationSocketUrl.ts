/** Builds the same-origin collaboration endpoint for one board. */
export function collaborationSocketUrl(boardId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/collaboration/${encodeURIComponent(boardId)}`;
}
