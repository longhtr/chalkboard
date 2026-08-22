/** The one notice shape used everywhere: title, optional body, optional actions. */
import type { ReactNode } from 'react';

export interface StatusNoticeAction {
  label: string;
  onClick(): void;
}

interface StatusNoticeProps {
  actions?: readonly StatusNoticeAction[];
  body: ReactNode;
  busy?: boolean;
  /** `warning` carries the amber treatment reserved for something gone wrong. */
  tone?: 'plain' | 'warning';
}

/**
 * Every status the application raises - a route that will not open, a board
 * that is gone, the result of an action - uses this one presentation, stacked
 * in the same corner. A second format for the same kind of message only makes
 * the reader work out whether the difference means anything.
 */
export function StatusNotice({
  actions = [],
  body,
  busy = false,
  tone = 'plain',
}: StatusNoticeProps) {
  return (
    <div
      className={
        tone === 'warning' ? 'operation-status is-error' : 'operation-status'
      }
      aria-busy={busy}
      role={tone === 'warning' ? 'alert' : 'status'}
    >
      <span>{body}</span>
      {actions.map((action) => (
        <button
          className="operation-status__action"
          key={action.label}
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
