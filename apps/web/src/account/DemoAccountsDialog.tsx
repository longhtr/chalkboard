/** Public shared-account chooser used while verification delivery is unavailable. */
import { DEMO_ACCOUNTS, type DemoAccount } from '@chalkboard/shared';

import { useModalFocus } from '../components/useModalFocus';

interface DemoAccountsDialogProps {
  onClose(): void;
  onSelect(account: DemoAccount): void;
}

/** Shows intentionally public credentials and their shared-data warning. */
export function DemoAccountsDialog({
  onClose,
  onSelect,
}: DemoAccountsDialogProps) {
  const dialogRef = useModalFocus<HTMLElement>();

  return (
    <div
      className="demo-account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="demo-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-account-title"
        aria-describedby="demo-account-warning"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      >
        <header className="demo-account-header">
          <div>
            <h3 id="demo-account-title">Choose a demo account</h3>
          </div>
          <button
            className="account-close"
            type="button"
            aria-label="Close demo accounts"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="demo-account-warning" id="demo-account-warning">
          <p>
            These accounts are public and shared. Content and sessions reset
            daily at 00:00 UTC, and other visitors can see or change saved work.
            Do not add personal or sensitive content.
          </p>
          <p>
            Demo accounts share boards only with other demo accounts. A demo
            account cannot open an invitation to a regular board, and a regular
            account cannot open an invitation to a demo board.
          </p>
        </div>
        <ul className="demo-account-list">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <div className="demo-account-credentials">
                <strong>{account.displayName}</strong>
                <span>
                  Email <code>{account.email}</code>
                </span>
                <span>
                  Password <code>{account.password}</code>
                </span>
              </div>
              <button
                type="button"
                onClick={() => onSelect(account)}
                data-dialog-autofocus={
                  account === DEMO_ACCOUNTS[0] ? '' : undefined
                }
              >
                Use account
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
