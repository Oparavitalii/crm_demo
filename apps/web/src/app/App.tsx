import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { notifications } from '@mantine/notifications';
import { ErrorBoundary } from 'react-error-boundary';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { theme } from './theme';
import { Router } from './routes';
import { ErrorFallback } from './ErrorFallback';
import { AuthHydrator } from './AuthHydrator';
import i18n from './i18n';
import * as sentry from '../lib/sentry';
import { formatApiErrorDetail, isNetworkError, parseApiError } from '../lib/http';

// Non-hook twin of useApiErrorMessage (lib/useApiErrorMessage.ts) — the
// MutationCache lives outside React, so it reads i18n directly.
function fallbackErrorMessage(err: unknown): string {
  const info = parseApiError(err);
  if (isNetworkError(info)) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? i18n.t('errors:offline')
      : i18n.t('errors:network');
  }
  const detail = formatApiErrorDetail(info);
  return detail ? `${i18n.t('errors:generic')}: ${detail}` : i18n.t('errors:generic');
}

const queryClient = new QueryClient({
  // 2026-07-04 safety net: NO mutation may fail silently. Any failed save
  // whose hook doesn't declare its own onError (and isn't flagged
  // meta.errorHandled by a call-site handler) gets the self-diagnosing toast.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError || mutation.meta?.errorHandled) return;
      notifications.show({ color: 'red', message: fallbackErrorMessage(error), autoClose: 8000 });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // 2026-07-02 — a transient API blip (rolling deploy, Neon cold start)
      // used to render as a permanently empty list until manual F5. Retry
      // twice with the default exponential backoff, but not on 4xx: those are
      // deterministic (401 refresh is already handled inside apiFetch).
      retry: (failureCount, error) => {
        const status = parseApiError(error).status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          return false;
        }
        return failureCount < 2;
      },
      // Returning to the tab re-fetches stale queries, so an error state
      // heals itself without the user knowing about F5.
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
});

export function App() {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(err, info) => sentry.captureException(err, { componentStack: info.componentStack })}
    >
      <MantineProvider theme={theme} defaultColorScheme="light">
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>
            <ModalsProvider>
              <Notifications position="top-right" />
              <AuthHydrator>
                <Router />
              </AuthHydrator>
              {import.meta.env.DEV && <ReactQueryDevtools />}
            </ModalsProvider>
          </NuqsAdapter>
        </QueryClientProvider>
      </MantineProvider>
    </ErrorBoundary>
  );
}
