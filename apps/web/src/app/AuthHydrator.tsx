import { type ReactNode, useEffect, useRef } from 'react';
import { hasSessionHint, useAuthStore } from '@/lib/auth-store';
import { fetchMe, silentRefresh } from '@/features/auth/api';

export function AuthHydrator({ children }: { children: ReactNode }) {
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    (async () => {
      // Skip the silent refresh entirely when there is no client-side hint
      // that a session ever existed in this browser. This avoids a guaranteed
      // 401 (and the browser's network-error console entry) on every visit by
      // an unauthenticated user. The refresh-token cookie is httpOnly so we
      // can't read it directly; the hint flag is set on setSession/login and
      // cleared on logout / 401-driven clearAuth.
      if (!hasSessionHint()) {
        useAuthStore.getState().markBootComplete();
        return;
      }
      const refreshed = await silentRefresh();
      if (refreshed) {
        try {
          const user = await fetchMe();
          // Re-read token after fetchMe (in case parallel 401 cleared it).
          // If token is gone, treat as not authenticated.
          const token = useAuthStore.getState().accessToken;
          if (token) {
            useAuthStore.getState().setSession(user, token);
          } else {
            useAuthStore.getState().clear();
          }
        } catch {
          useAuthStore.getState().clear();
        }
      }
      useAuthStore.getState().markBootComplete();
    })();
  }, []);

  return <>{children}</>;
}
