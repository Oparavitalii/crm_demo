import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import * as sentry from './lib/sentry';
import './app/i18n';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/tiptap/styles.css';
import './app/global.css';

// No-op when VITE_SENTRY_DSN is unset (dev / preview / no-cred prod build).
sentry.init();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element not found in index.html');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failures are non-fatal — the app still works without offline.
    });
  });
}
