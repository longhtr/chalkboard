/**
 * A counter that advances every time the workspace font finishes loading.
 *
 * Rendered blocks decorate themselves from what MathLive actually painted, and
 * the two faces do not put the same ink in the same place, so a font swap has
 * to redo that work. The markup is unchanged by a swap, so nothing else in a
 * block's inputs would tell it to.
 *
 * One window listener serves every block. Subscribing per block would attach a
 * listener for each of the hundred a board can show at once.
 */
import { useSyncExternalStore } from 'react';

import { WORKSPACE_FONT_READY_EVENT } from './mathLiveRuntime';

let revision = 0;
let listening = false;
const listeners = new Set<() => void>();

function advance(): void {
  revision += 1;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener(WORKSPACE_FONT_READY_EVENT, advance);
    listening = true;
  }
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number {
  return revision;
}

/** Changes identity once per completed font load, and never otherwise. */
export function useWorkspaceFontRevision(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
