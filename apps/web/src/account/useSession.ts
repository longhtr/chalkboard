/**
 * Owns browser session restoration and explicit authenticated/anonymous/offline
 * transitions. Cached user identity supports explanation while offline but never
 * grants cloud authority.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { bestEffortLocalStorage } from '../bestEffortStorage';
import { decodeUserResponse, isApiError, requestApi, type User } from './api';

export type { User } from './api';

/** Browser session bootstrap state, including retryable unavailability. */
export type SessionState =
  | { status: 'loading'; user: User | null }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous'; user: null }
  | { status: 'offline-unknown'; user: User | null };

const LAST_ACCOUNT_KEY = 'chalkboard:last-account';

function loadCachedUser(): User | null {
  try {
    const value: unknown = JSON.parse(
      bestEffortLocalStorage.getItem(LAST_ACCOUNT_KEY) ?? 'null',
    );
    if (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof value.id === 'string' &&
      'email' in value &&
      typeof value.email === 'string' &&
      'displayName' in value &&
      typeof value.displayName === 'string'
    ) {
      return {
        id: value.id,
        email: value.email,
        displayName: value.displayName,
        isDemo:
          'isDemo' in value && typeof value.isDemo === 'boolean'
            ? value.isDemo
            : false,
      };
    }
  } catch {
    // Ignore malformed compatibility state.
  }
  return null;
}

function cacheUser(user: User | null): void {
  if (user === null) bestEffortLocalStorage.removeItem(LAST_ACCOUNT_KEY);
  else bestEffortLocalStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(user));
}

/** Restores, caches, replaces, and clears the authenticated user session. */
export function useSession(): {
  authenticate(user: User): void;
  expire(): void;
  refresh(): Promise<void>;
  session: SessionState;
  signOut(): void;
} {
  const [session, setSession] = useState<SessionState>(() => ({
    status: 'loading',
    user: loadCachedUser(),
  }));
  const transitionRevisionRef = useRef(0);

  const restore = useCallback(async () => {
    const revision = ++transitionRevisionRef.current;
    try {
      const result = await requestApi(
        '/api/session',
        undefined,
        decodeUserResponse,
      );
      if (revision !== transitionRevisionRef.current) return;
      cacheUser(result.user);
      setSession({ status: 'authenticated', user: result.user });
    } catch (error) {
      if (revision !== transitionRevisionRef.current) return;
      if (isApiError(error) && error.status === 401) {
        cacheUser(null);
        setSession({ status: 'anonymous', user: null });
      } else {
        setSession((current) => ({
          status: 'offline-unknown',
          user: current.user,
        }));
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setSession((current) => ({ status: 'loading', user: current.user }));
    await restore();
  }, [restore]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => void restore());
    return () => window.clearTimeout(restoreTimer);
  }, [restore]);

  const authenticate = useCallback((user: User) => {
    transitionRevisionRef.current += 1;
    cacheUser(user);
    setSession({ status: 'authenticated', user });
  }, []);

  // Server rejection and deliberate sign-out clear identical browser state; the
  // two names stay separate because their callers differ, one restoring the
  // requested board behind a sign-in prompt and the other leaving for a local board.
  const clearSession = useCallback(() => {
    transitionRevisionRef.current += 1;
    cacheUser(null);
    setSession({ status: 'anonymous', user: null });
  }, []);

  return {
    authenticate,
    expire: clearSession,
    refresh,
    session,
    signOut: clearSession,
  };
}
