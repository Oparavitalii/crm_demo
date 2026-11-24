import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LoginInput,
  LoginResponse,
  PublicUser,
  ResetConfirmInput,
  ResetRequestInput,
  Verify2FAInput,
  Enroll2FAResponse,
  Confirm2FAInput,
  Disable2FAInput,
  AcceptInvitationInput,
  AcceptInvitationResponse,
} from '@opushr/shared';
import { apiFetch, http, performTokenRefresh } from '@/lib/http';
import { useAuthStore } from '@/lib/auth-store';

// ---------------------------------------------------------------------------
// Non-hook helpers (used by AuthHydrator outside React component tree)
// ---------------------------------------------------------------------------

/**
 * Attempts a silent token refresh via the httpOnly cookie.
 * Returns true on success (new token stored), false on failure.
 *
 * Delegates to performTokenRefresh, which serializes across tabs (Web Lock),
 * retries transport failures (laptop just woke, Fly cold start), and clears
 * auth state ONLY on a definitive 401/403 — a network blip at boot no longer
 * drops the session hint, so the still-valid cookie survives for the next try.
 */
export async function silentRefresh(): Promise<boolean> {
  return (await performTokenRefresh()) === 'ok';
}

/**
 * Fetches the current authenticated user from /auth/me.
 * Uses apiFetch so a 401 will trigger the refresh interceptor.
 */
export async function fetchMe(): Promise<PublicUser> {
  const res = await apiFetch<{ user: PublicUser }>('/auth/me');
  return res.user;
}

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

/** Login mutation — caller must check requires2FA flag before calling setSession. */
export function useLogin() {
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<LoginResponse> => {
      return http<LoginResponse>('/auth/login', { method: 'POST', body: input });
    },
    meta: { errorHandled: true },
  });
}

/** Verify 2FA code with partialToken — sets session on success. */
export function useVerify2FA() {
  return useMutation({
    mutationFn: async (input: Verify2FAInput): Promise<{ user: PublicUser; accessToken: string }> => {
      return http('/auth/login/verify-2fa', { method: 'POST', body: input });
    },
    meta: { errorHandled: true },
    onSuccess: (data) => {
      useAuthStore.getState().setSession(data.user, data.accessToken);
    },
  });
}

/** Start 2FA enrollment — returns secret + qrCodeDataUrl. */
export function useEnroll2FA() {
  return useMutation({
    mutationFn: async (): Promise<Enroll2FAResponse> => {
      return apiFetch('/auth/2fa/enroll', { method: 'POST' });
    },
    meta: { errorHandled: true },
  });
}

/** Confirm 2FA enrollment — verifies code with secret returned from enroll step. */
export function useConfirm2FA() {
  return useMutation({
    mutationFn: async (input: Confirm2FAInput): Promise<{ ok: boolean }> => {
      return apiFetch('/auth/2fa/confirm', { method: 'POST', body: input });
    },
    meta: { errorHandled: true },
  });
}

/** Disable 2FA — requires current password + current TOTP code. */
export function useDisable2FA() {
  return useMutation({
    mutationFn: async (input: Disable2FAInput): Promise<{ ok: boolean }> => {
      return apiFetch('/auth/2fa/disable', { method: 'POST', body: input });
    },
    meta: { errorHandled: true },
  });
}

/** Logout mutation — clears store + query cache regardless of network outcome. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Fire-and-forget; backend session row deleted, cookie cleared by server
      try {
        await apiFetch('/auth/logout', { method: 'POST' });
      } catch {
        // Even on network failure, clear locally so user isn't stuck
      }
    },
    onSettled: () => {
      useAuthStore.getState().clear();
      qc.clear();
    },
  });
}

/**
 * Query for the current user from /auth/me.
 *
 * Only enabled after boot completes AND a user is already in the store.
 * `initialData` pre-populates from the store so no extra network call is
 * made on the first render when the store already has the user (set during
 * AuthHydrator boot).
 */
export function useCurrentUser() {
  const bootComplete = useAuthStore((s) => s.bootComplete);
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMe,
    enabled: bootComplete && !!user,
    initialData: user ?? undefined,
  });
}

/** Request a password reset email for the given address. */
export function useRequestReset() {
  return useMutation({
    mutationFn: async (input: ResetRequestInput) => {
      return http('/auth/reset-password/request', { method: 'POST', body: input });
    },
    meta: { errorHandled: true },
  });
}

/** Confirm a password reset with token + new password. */
export function useConfirmReset() {
  return useMutation({
    mutationFn: async (input: ResetConfirmInput) => {
      return http('/auth/reset-password/confirm', { method: 'POST', body: input });
    },
    meta: { errorHandled: true },
  });
}

/** Accept an invitation — creates the user account. Public, no auth required. */
export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async (input: AcceptInvitationInput): Promise<AcceptInvitationResponse> => {
      return http('/register/accept-invite', { method: 'POST', body: input });
    },
    meta: { errorHandled: true },
  });
}
