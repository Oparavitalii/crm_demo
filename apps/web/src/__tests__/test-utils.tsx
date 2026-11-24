/**
 * test-utils.tsx — shared render helpers for RTL component tests.
 *
 * Wraps a component in the minimal provider stack used in production:
 *   MantineProvider + Notifications + QueryClientProvider + MemoryRouter +
 *   I18nextProvider.
 *
 * i18n strategy: we boot a stub i18next instance whose translator returns the
 * key itself (no resource bundles loaded). Tests assert on raw keys like
 * `'fields.firstName'` so they don't break when PL/UA copy is edited.
 *
 * react-query: each `renderWithProviders` call gets a FRESH QueryClient with
 * retries disabled so failed queries do not retry across tests.
 */
import { ReactElement, ReactNode, useMemo } from 'react';
import { afterEach } from 'vitest';
import { cleanup, render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// RTL's auto-cleanup only runs when this module is imported under a test
// runner that explicitly opts in. Vitest 2 with our minimal setup does NOT
// register it automatically; without this hook, DOM nodes from previous
// tests stick around and trigger "found multiple elements" errors.
afterEach(() => {
  cleanup();
});
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

// ---------------------------------------------------------------------------
// jsdom polyfills — Mantine v7 components rely on these browser APIs that
// jsdom does not implement. Installed as a side-effect of importing this
// module so test files don't need their own setup.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
  if (!('scrollTo' in window)) {
    (window as unknown as { scrollTo: () => void }).scrollTo = () => {};
  }
  // Mantine's Combobox scrolls the active option into view on a timer, so a
  // missing scrollIntoView surfaces as an UNHANDLED exception after the test
  // that opened a Select has already finished — reported against whichever
  // test happened to be running next. jsdom does not implement it.
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

// Boot a singleton i18n stub once per test process. Translator returns the
// missing key as the value so test assertions can match on stable keys.
let i18nReady: typeof i18next | null = null;
function getI18n(): typeof i18next {
  if (i18nReady) return i18nReady;
  const inst = i18next.createInstance();
  void inst.use(initReactI18next).init({
    lng: 'pl',
    fallbackLng: 'pl',
    // Register the namespaces the tested components actually use so missing-key
    // warnings don't pollute the console.
    ns: ['common', 'candidates', 'operations', 'errors'],
    defaultNS: 'common',
    resources: {
      pl: {
        common: {},
        candidates: {},
        operations: {},
        errors: {},
      },
    },
    interpolation: { escapeValue: false },
    // Returning the key itself keeps tests independent of translation text.
    parseMissingKeyHandler: (key) => key,
    // Suppress console noise from inevitable missing keys.
    saveMissing: false,
  });
  i18nReady = inst;
  return inst;
}

interface ProvidersProps {
  children: ReactNode;
  initialRoute?: string;
}

function AllProviders({ children, initialRoute = '/' }: ProvidersProps) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0, staleTime: 0 },
          mutations: { retry: false },
        },
      }),
    [],
  );
  return (
    <I18nextProvider i18n={getI18n()}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <MantineProvider>
            <Notifications />
            {children}
          </MantineProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  initialRoute?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  { initialRoute, ...options }: RenderWithProvidersOptions = {},
): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders initialRoute={initialRoute}>{children}</AllProviders>
    ),
    ...options,
  });
}

// Re-export for convenience so tests only need to import from test-utils.
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
