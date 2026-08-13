/**
 * Login/registration fields and focus recovery. Client validation gives prompt
 * feedback; server validation and password admission remain authoritative.
 */
import {
  MAX_ACCOUNT_DISPLAY_NAME_LENGTH,
  MAX_ACCOUNT_EMAIL_LENGTH,
  MAX_ACCOUNT_PASSWORD_LENGTH,
  MIN_ACCOUNT_PASSWORD_LENGTH,
  type DemoAccount,
} from '@chalkboard/shared';
import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  decodeUserResponse,
  decodeVerificationRequiredResponse,
  isApiError,
  isUnavailableError,
  requestApi,
  type User,
} from './api';
import { DemoAccountsDialog } from './DemoAccountsDialog';
import { HumanVerification } from './HumanVerification';
import { PasswordResetForm } from './PasswordResetForm';
import { VerificationCodeForm } from './VerificationCodeForm';

const EMAIL_AUTOCOMPLETE_CHARACTER_THRESHOLD = 1;

interface FieldErrors {
  confirmPassword?: string;
  displayName?: string;
  email?: string;
  password?: string;
}

interface AccountFormProps {
  mode: 'login' | 'register';
  offline: boolean;
  onAuthenticated(user: User): void;
  onModeChange(mode: 'login' | 'register'): void;
  /** Lets the surrounding panel title the reset step as something other than sign-in. */
  onPasswordResetOpenChange?(open: boolean): void;
  onRefreshSession(): Promise<void>;
}

function likelyEmail(value: string): boolean {
  return (
    value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
  );
}

/** Owns authentication fields, validation, submission, and focus recovery. */
export function AccountForm({
  mode,
  offline,
  onAuthenticated,
  onModeChange,
  onPasswordResetOpenChange,
  onRefreshSession,
}: AccountFormProps) {
  const displayNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const refreshEmailAutocompleteRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pendingRegistrationEmail, setPendingRegistrationEmail] = useState<
    string | null
  >(null);
  const [passwordResetOpen, setPasswordResetOpenState] = useState(false);
  // Routed through one helper so the surrounding panel title stays in step.
  const setPasswordResetOpen = useCallback(
    (open: boolean) => {
      setPasswordResetOpenState(open);
      onPasswordResetOpenChange?.(open);
    },
    [onPasswordResetOpenChange],
  );
  const [demoAccountsOpen, setDemoAccountsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [humanVerificationToken, setHumanVerificationToken] = useState<
    string | null
  >(null);
  const [humanVerificationResetKey, setHumanVerificationResetKey] = useState(0);

  useLayoutEffect(() => {
    if (!refreshEmailAutocompleteRef.current) return;
    refreshEmailAutocompleteRef.current = false;
    const input = emailRef.current;
    if (input === null || document.activeElement !== input) return;
    input.blur();
    input.focus({ preventScroll: true });
  }, [email]);

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    if (error !== '') setError('');
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (mode === 'register' && displayName.trim() === '') {
      next.displayName = 'Enter the name people will see on shared boards.';
    }
    if (!likelyEmail(email)) next.email = 'Enter a valid email address.';
    if (password.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters.`;
    }
    if (mode === 'register' && confirmPassword !== password) {
      next.confirmPassword = 'Passwords do not match.';
    }
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validate();
    setFieldErrors(validation);
    setError('');
    if (Object.keys(validation).length > 0) {
      if (validation.displayName !== undefined) displayNameRef.current?.focus();
      else if (validation.email !== undefined) emailRef.current?.focus();
      else if (validation.password !== undefined) passwordRef.current?.focus();
      else if (validation.confirmPassword !== undefined) {
        confirmPasswordRef.current?.focus();
      }
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'register') {
        const result = await requestApi(
          '/api/auth/register',
          {
            method: 'POST',
            body: JSON.stringify({
              displayName,
              email: email.trim(),
              humanVerificationToken,
              password,
            }),
          },
          decodeVerificationRequiredResponse,
        );
        setPendingRegistrationEmail(result.email ?? email.trim());
      } else {
        const result = await requestApi(
          '/api/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ email: email.trim(), password }),
          },
          decodeUserResponse,
        );
        setPassword('');
        onAuthenticated(result.user);
      }
    } catch (caught) {
      if (mode === 'login' && isApiError(caught) && caught.status === 401) {
        setError(
          'We couldn’t sign you in. Check your email and password and try again.',
        );
        setPassword('');
        window.setTimeout(() => passwordRef.current?.focus());
      } else if (
        mode === 'register' &&
        isApiError(caught) &&
        caught.status === 409
      ) {
        setError(
          'This account cannot be created. Try signing in or resetting the password.',
        );
      } else if (isApiError(caught) && caught.status === 502) {
        setError(caught.message);
      } else if (isUnavailableError(caught)) {
        setError('Chalkboard is offline. Your local board is still available.');
      } else {
        setError(
          isApiError(caught)
            ? caught.message
            : 'We couldn’t continue. Try again.',
        );
      }
    } finally {
      if (mode === 'register') {
        setHumanVerificationToken(null);
        setHumanVerificationResetKey((current) => current + 1);
      }
      setSubmitting(false);
    }
  }

  async function verifyRegistration(code: string) {
    if (pendingRegistrationEmail === null) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await requestApi(
        '/api/auth/verify-email',
        {
          method: 'POST',
          body: JSON.stringify({ code, email: pendingRegistrationEmail }),
        },
        decodeUserResponse,
      );
      setPassword('');
      setConfirmPassword('');
      onAuthenticated(result.user);
    } catch (caught) {
      setError(
        isApiError(caught)
          ? caught.message
          : 'The email could not be verified. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function useDemoAccount(account: DemoAccount) {
    setEmail(account.email);
    setPassword(account.password);
    setConfirmPassword('');
    setFieldErrors({});
    setError('');
    setNotice('');
    setDemoAccountsOpen(false);
    onModeChange('login');
    window.requestAnimationFrame(() => emailRef.current?.focus());
  }

  function switchMode(event: MouseEvent<HTMLButtonElement>) {
    if (submitting) return;
    const nextMode = mode === 'login' ? 'register' : 'login';
    setPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setError('');
    setNotice('');
    setPendingRegistrationEmail(null);
    setPasswordResetOpen(false);
    setDemoAccountsOpen(false);
    setHumanVerificationToken(null);
    setHumanVerificationResetKey((current) => current + 1);
    const focusOwner = event.currentTarget;
    onModeChange(nextMode);
    window.requestAnimationFrame(() => {
      if (document.activeElement !== focusOwner) return;
      (nextMode === 'register'
        ? displayNameRef.current
        : emailRef.current
      )?.focus({ preventScroll: true });
    });
  }

  if (pendingRegistrationEmail !== null) {
    return (
      <VerificationCodeForm
        destination={pendingRegistrationEmail}
        error={error}
        onCancel={() => {
          setPendingRegistrationEmail(null);
          setError('');
        }}
        onVerify={verifyRegistration}
        submitting={submitting}
        title="Verify your email before creating the account"
      />
    );
  }

  if (passwordResetOpen) {
    return (
      <PasswordResetForm
        initialEmail={email}
        onBack={() => setPasswordResetOpen(false)}
        onCompleted={(resetEmail) => {
          setEmail(resetEmail);
          setPasswordResetOpen(false);
          setNotice('Password updated. Sign in with your new password.');
        }}
      />
    );
  }

  return (
    <>
      {offline && (
        <div className="account-status" role="status">
          <strong>Chalkboard is offline.</strong>
          <span>Your local board is still available.</span>
          <button type="button" onClick={() => void onRefreshSession()}>
            Try again
          </button>
        </div>
      )}
      <form
        aria-busy={submitting}
        className="account-form"
        noValidate
        onSubmit={submit}
      >
        {mode === 'login' ? (
          <div className="account-status account-registration-status">
            <strong>Want to explore cloud boards first?</strong>
            <button
              className="account-inline-link"
              type="button"
              onClick={() => setDemoAccountsOpen(true)}
            >
              View demo accounts
            </button>
          </div>
        ) : (
          <div className="account-status account-registration-status">
            <strong>New accounts are not open yet.</strong>
            <span>
              Our email provider has not yet approved delivery to public
              addresses, so we cannot send the code that completes sign-up. Demo
              accounts are the only way to try cloud boards for now.
            </span>
            <button
              className="account-inline-link"
              type="button"
              onClick={() => setDemoAccountsOpen(true)}
            >
              View demo accounts
            </button>
          </div>
        )}
        {mode === 'register' && (
          <label>
            Display name
            <input
              ref={displayNameRef}
              aria-label="Display name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                clearFieldError('displayName');
              }}
              aria-invalid={fieldErrors.displayName !== undefined}
              aria-describedby={
                fieldErrors.displayName === undefined
                  ? undefined
                  : 'display-name-error'
              }
              name="displayName"
              maxLength={MAX_ACCOUNT_DISPLAY_NAME_LENGTH}
              autoComplete="name"
            />
            {fieldErrors.displayName !== undefined && (
              <span className="account-field-error" id="display-name-error">
                {fieldErrors.displayName}
              </span>
            )}
          </label>
        )}
        <label>
          Email
          <input
            ref={emailRef}
            aria-label="Email"
            data-dialog-autofocus={mode === 'login' ? '' : undefined}
            value={email}
            onChange={(event) => {
              const nextEmail = event.target.value;
              if (
                email.length < EMAIL_AUTOCOMPLETE_CHARACTER_THRESHOLD &&
                nextEmail.length >= EMAIL_AUTOCOMPLETE_CHARACTER_THRESHOLD &&
                document.activeElement === event.currentTarget
              ) {
                refreshEmailAutocompleteRef.current = true;
              }
              setEmail(nextEmail);
              clearFieldError('email');
            }}
            aria-invalid={fieldErrors.email !== undefined}
            aria-describedby={
              fieldErrors.email === undefined ? undefined : 'email-error'
            }
            name="email"
            type="email"
            maxLength={MAX_ACCOUNT_EMAIL_LENGTH}
            inputMode="email"
            autoComplete={
              email.length >= EMAIL_AUTOCOMPLETE_CHARACTER_THRESHOLD
                ? 'email'
                : 'off'
            }
          />
          {fieldErrors.email !== undefined && (
            <span className="account-field-error" id="email-error">
              {fieldErrors.email}
            </span>
          )}
        </label>
        <label>
          Password
          <input
            ref={passwordRef}
            aria-label="Password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearFieldError('password');
            }}
            aria-invalid={fieldErrors.password !== undefined}
            aria-describedby={
              fieldErrors.password === undefined ? undefined : 'password-error'
            }
            name="password"
            type="password"
            maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
          />
          {fieldErrors.password !== undefined && (
            <span className="account-field-error" id="password-error">
              {fieldErrors.password}
            </span>
          )}
        </label>
        {mode === 'register' && (
          <label>
            Confirm password
            <input
              ref={confirmPasswordRef}
              aria-label="Confirm password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                clearFieldError('confirmPassword');
              }}
              aria-invalid={fieldErrors.confirmPassword !== undefined}
              aria-describedby={
                fieldErrors.confirmPassword === undefined
                  ? undefined
                  : 'confirm-password-error'
              }
              name="confirmPassword"
              type="password"
              maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
              autoComplete="new-password"
            />
            {fieldErrors.confirmPassword !== undefined && (
              <span className="account-field-error" id="confirm-password-error">
                {fieldErrors.confirmPassword}
              </span>
            )}
          </label>
        )}
        {mode === 'register' ? (
          <HumanVerification
            action="registration"
            disabled={submitting}
            onToken={setHumanVerificationToken}
            resetKey={humanVerificationResetKey}
          />
        ) : null}
        {mode === 'login' ? (
          <button
            className="account-forgot-password"
            type="button"
            disabled={submitting}
            onClick={() => {
              setError('');
              setNotice('');
              setPasswordResetOpen(true);
            }}
          >
            Forgot password?
          </button>
        ) : null}
        {notice !== '' ? (
          <p className="account-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error !== '' && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="account-primary"
          type="submit"
          disabled={
            submitting ||
            (mode === 'register' && humanVerificationToken === null)
          }
        >
          {submitting
            ? mode === 'login'
              ? 'Signing in…'
              : 'Creating account…'
            : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>
      {demoAccountsOpen ? (
        <DemoAccountsDialog
          onClose={() => setDemoAccountsOpen(false)}
          onSelect={useDemoAccount}
        />
      ) : null}
      <p className="account-mode-switch">
        {mode === 'login' ? 'New to Chalkboard?' : 'Already have an account?'}
        <button type="button" disabled={submitting} onClick={switchMode}>
          {mode === 'login' ? 'Create account' : 'Sign in'}
        </button>
      </p>
    </>
  );
}
