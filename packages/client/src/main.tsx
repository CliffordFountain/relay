import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './stores/store';

// Expose Redux store for E2E tests and dev tooling
// Safe to expose in dev builds (never in production bundle, tree-shaken out)
if (import.meta.env.MODE !== 'production') {
  (window as unknown as Record<string, unknown>).__REDUX_STORE__ = store;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
