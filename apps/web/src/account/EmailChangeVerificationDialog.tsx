/** Modal email-change verification that preserves the underlying Account draft. */
import { createPortal } from 'react-dom';

import { useModalFocus } from '../components/useModalFocus';
import { VerificationCodeForm } from './VerificationCodeForm';

interface EmailChangeVerificationDialogProps {
  destination: string;
  error: string;
  onCancel(): void;
  onVerify(code: string): Promise<void>;
  submitting: boolean;
}

/** Keeps the second email-change step above, rather than inside, Account settings. */
export function EmailChangeVerificationDialog({
  destination,
  error,
  onCancel,
  onVerify,
  submitting,
}: EmailChangeVerificationDialogProps) {
  const dialogRef = useModalFocus<HTMLElement>();

  return createPortal(
    <div
      className="email-verification-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (!submitting && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="email-verification-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-verification-dialog-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (!submitting && event.key === 'Escape') onCancel();
        }}
      >
        <header className="account-header">
          <div>
            <h2 id="email-verification-dialog-title">Verify new email</h2>
          </div>
          <button
            className="account-close"
            type="button"
            aria-label="Close email verification"
            disabled={submitting}
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <VerificationCodeForm
          destination={destination}
          error={error}
          onCancel={onCancel}
          onVerify={onVerify}
          submitting={submitting}
          title="Verify the new email before changing your account"
        />
      </section>
    </div>,
    document.body,
  );
}
