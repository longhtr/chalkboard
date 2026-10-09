/** Turnstile in production and an explicit no-network substitute in local development. */
import { useEffect, useId, useRef, useState } from 'react';

import { requestApi } from './api';
import {
  recordTurnstileBrowserDiagnostic,
  type TurnstileBrowserStage,
} from './turnstileBrowserDiagnostics';

type Turnstile = {
  remove(widgetId: string): void;
  render(
    container: HTMLElement,
    options: {
      action: string;
      callback(token: string): void;
      'error-callback'(errorCode?: unknown): void;
      'expired-callback'(): void;
      'timeout-callback'(): void;
      sitekey: string;
      theme: 'auto';
    },
  ): string;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const TURNSTILE_SCRIPT_ID = 'chalkboard-turnstile-script';
const TURNSTILE_SCRIPT_TIMEOUT_MS = 10_000;
const TURNSTILE_TOKEN_MAX_LENGTH = 2_048;
let scriptPromise: Promise<void> | null = null;

class TurnstileBrowserBoundaryError extends Error {
  constructor(
    readonly stage: TurnstileBrowserStage,
    options?: ErrorOptions,
  ) {
    super(`Turnstile browser boundary failed: ${stage}`, options);
    this.name = 'TurnstileBrowserBoundaryError';
  }
}

function loadTurnstile(): Promise<void> {
  if (window.turnstile !== undefined) return Promise.resolve();
  if (scriptPromise !== null) return scriptPromise;
  document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (
      outcome: 'resolve' | 'reject',
      error?: TurnstileBrowserBoundaryError,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outcome === 'resolve') resolve();
      else {
        script.remove();
        scriptPromise = null;
        reject(error);
      }
    };
    const timer = window.setTimeout(
      () =>
        finish('reject', new TurnstileBrowserBoundaryError('script-timeout')),
      TURNSTILE_SCRIPT_TIMEOUT_MS,
    );
    script.async = true;
    script.defer = true;
    script.id = TURNSTILE_SCRIPT_ID;
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.addEventListener('load', () => finish('resolve'), { once: true });
    script.addEventListener(
      'error',
      () => finish('reject', new TurnstileBrowserBoundaryError('script-error')),
      { once: true },
    );
    document.head.append(script);
  });
  return scriptPromise;
}

function decodeConfiguration(value: unknown): { siteKey: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('humanVerification' in value) ||
    typeof value.humanVerification !== 'object' ||
    value.humanVerification === null ||
    !('provider' in value.humanVerification) ||
    value.humanVerification.provider !== 'turnstile' ||
    !('siteKey' in value.humanVerification) ||
    typeof value.humanVerification.siteKey !== 'string' ||
    value.humanVerification.siteKey.length === 0
  ) {
    throw new Error('Invalid public configuration');
  }
  return { siteKey: value.humanVerification.siteKey };
}

interface HumanVerificationProps {
  action: 'password-reset' | 'registration';
  development?: boolean;
  disabled: boolean;
  onToken(token: string | null): void;
  resetKey: number;
}

export function HumanVerification({
  action,
  development = import.meta.env.DEV,
  disabled,
  onToken,
  resetKey,
}: HumanVerificationProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    onTokenRef.current(null);
    if (development) return;
    let active = true;
    let widgetId: string | null = null;
    const startedAt = performance.now();
    const record = (
      stage: TurnstileBrowserStage,
      outcome: 'debug' | 'failure',
      input: { error?: unknown; providerErrorCode?: unknown } = {},
    ) => {
      try {
        recordTurnstileBrowserDiagnostic({
          action,
          attempt: attempt + 1,
          elapsedMilliseconds: performance.now() - startedAt,
          outcome,
          stage,
          ...input,
        });
      } catch {
        // Browser diagnostics must never change human-verification admission.
      }
    };
    void Promise.all([
      loadTurnstile(),
      requestApi('/api/public-config', undefined, decodeConfiguration),
    ])
      .then(([, configuration]) => {
        if (!active || containerRef.current === null) return;
        record('script-loaded', 'debug');
        setError('');
        const turnstile = window.turnstile;
        if (turnstile === undefined) {
          document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
          scriptPromise = null;
          throw new TurnstileBrowserBoundaryError('missing-api');
        }
        let renderedWidgetId: string;
        try {
          renderedWidgetId = turnstile.render(containerRef.current, {
            action,
            callback: (token) => {
              if (!active) return;
              if (
                typeof token !== 'string' ||
                token.length === 0 ||
                token.length > TURNSTILE_TOKEN_MAX_LENGTH
              ) {
                record('invalid-token', 'failure');
                onTokenRef.current(null);
                setError('Human verification failed to load. Try again.');
                return;
              }
              record('completed', 'debug');
              setError('');
              onTokenRef.current(token);
            },
            'error-callback': (errorCode) => {
              if (!active) return;
              record('provider-error', 'failure', {
                providerErrorCode: errorCode,
              });
              onTokenRef.current(null);
              setError('Human verification failed to load. Try again.');
            },
            'expired-callback': () => {
              if (!active) return;
              record('expired', 'failure');
              onTokenRef.current(null);
            },
            'timeout-callback': () => {
              if (!active) return;
              record('provider-timeout', 'failure');
              onTokenRef.current(null);
              setError('Human verification failed to load. Try again.');
            },
            sitekey: configuration.siteKey,
            theme: 'auto',
          });
        } catch (error) {
          throw new TurnstileBrowserBoundaryError('render', { cause: error });
        }
        if (
          typeof renderedWidgetId !== 'string' ||
          renderedWidgetId.length === 0 ||
          renderedWidgetId.length > 512
        ) {
          throw new TurnstileBrowserBoundaryError('render');
        }
        widgetId = renderedWidgetId;
        record('rendered', 'debug');
      })
      .catch((error: unknown) => {
        const stage =
          error instanceof TurnstileBrowserBoundaryError
            ? error.stage
            : 'render';
        record(stage, 'failure', {
          error:
            error instanceof TurnstileBrowserBoundaryError &&
            error.cause !== undefined
              ? error.cause
              : error,
        });
        if (active) setError('Human verification is unavailable. Try again.');
      });
    return () => {
      active = false;
      if (widgetId !== null) {
        try {
          window.turnstile?.remove(widgetId);
        } catch (error) {
          record('removal', 'failure', { error });
        }
      }
    };
  }, [action, attempt, development, resetKey]);

  if (development) {
    return (
      <label className="human-verification human-verification--development">
        <input
          aria-describedby={`${id}-description`}
          aria-label="I am not a robot"
          disabled={disabled}
          key={resetKey}
          type="checkbox"
          onChange={(event) =>
            onToken(
              event.target.checked ? 'development-human-verification' : null,
            )
          }
        />
        <span>
          I am not a robot
          <small id={`${id}-description`}>Local test only</small>
        </span>
      </label>
    );
  }

  return (
    <div className="human-verification">
      <div ref={containerRef} aria-label="Human verification" />
      {error === '' ? null : (
        <div className="human-verification-error">
          <p className="account-field-error" role="alert">
            {error}
          </p>
          <button
            className="human-verification-retry"
            disabled={disabled}
            type="button"
            onClick={() => {
              setError('');
              setAttempt((value) => value + 1);
            }}
          >
            Retry human verification
          </button>
        </div>
      )}
    </div>
  );
}
