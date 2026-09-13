import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement object-URL APIs. Provide no-op stubs so components that
// create/revoke blob URLs for previews don't throw during tests. Individual tests may
// still override these (e.g. to assert calls) and restore afterwards.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock-url';
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => { /* no-op */ };
}
