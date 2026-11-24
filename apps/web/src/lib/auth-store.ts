import { create } from 'zustand';
import type { PublicUser } from '@opushr/shared';

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  bootComplete: boolean;
  setSession: (user: PublicUser, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  clear: () => void;
  markBootComplete: () => void;
}

// ---------------------------------------------------------------------------
// Session hint — a localStorage flag that signals "this browser has logged in
// before, so a refresh-token cookie *may* exist". Used by AuthHydrator to
// decide whether to call /auth/refresh on app mount. Without this gate, every
// anonymous visitor triggers a 401 that the browser logs as a console error
// (cosmetic noise, not a real bug). The flag is set on setSession and cleared
// on clear / explicit logout. Worst case: a stale hint causes one extra 401,
// which then clears the hint via clearAuth in the http interceptor.
// ---------------------------------------------------------------------------
const SESSION_HINT_KEY = 'opushr_session';

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function hasSessionHint(): boolean {
  return safeStorage()?.getItem(SESSION_HINT_KEY) === '1';
}

function setSessionHint(): void {
  try {
    safeStorage()?.setItem(SESSION_HINT_KEY, '1');
  } catch {
    // Storage may be disabled (private mode, quota); silently ignore.
  }
}

function clearSessionHint(): void {
  try {
    safeStorage()?.removeItem(SESSION_HINT_KEY);
  } catch {
    // Ignore.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  bootComplete: false,
  setSession: (user, accessToken) => {
    setSessionHint();
    set({ user, accessToken });
  },
  setAccessToken: (accessToken) => {
    setSessionHint();
    set({ accessToken });
  },
  clear: () => {
    clearSessionHint();
    set({ user: null, accessToken: null });
  },
  markBootComplete: () => set({ bootComplete: true }),
}));

// Non-hook accessors for use inside HTTP interceptor (outside React component tree)
export const getAccessToken = (): string | null => useAuthStore.getState().accessToken;
export const setAccessTokenSync = (t: string): void => useAuthStore.getState().setAccessToken(t);
export const clearAuth = (): void => useAuthStore.getState().clear();
