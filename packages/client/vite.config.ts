import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import fs from 'fs';

// Optional HTTPS for the dev server, gated by an env flag so plain HTTP stays
// the default (E2E and http://localhost must keep working unchanged).
//
// Why this exists: getUserMedia / getDisplayMedia only run in a *secure
// context*. On a phone browsing http://<lan-ip>:5173 that isn't secure, so the
// mic/camera permission prompt never appears. Serving the same page over HTTPS
// makes it a secure context. Enable it with VITE_HTTPS=true (see docker-compose
// / .env); the self-signed cert requires a one-time "proceed anyway" on the
// device.
const useHttps = process.env.VITE_HTTPS === 'true';
// Prefer a stable cert (certs/) with SANs for your host/domain + the LAN IP + localhost,
// so it can be installed once as trusted on a phone; fall back to an auto self-signed
// cert (basic-ssl) if those files are absent.
const certFile = path.resolve(__dirname, 'certs/cert.pem');
const keyFile = path.resolve(__dirname, 'certs/key.pem');
const hasCert = useHttps && fs.existsSync(certFile) && fs.existsSync(keyFile);

export default defineConfig({
  plugins: [react(), ...(useHttps && !hasCert ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Docker bind mounts on Windows/macOS do not deliver filesystem (inotify)
    // events into the Linux container, so Vite's watcher never sees host edits
    // and keeps serving stale modules (HMR appears dead; the app shows old code
    // until the container restarts). Fall back to polling when running that way
    // — docker-compose sets CHOKIDAR_USEPOLLING=true for the client service.
    // Native/host dev leaves polling off to avoid needless CPU churn.
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    ...(hasCert ? { https: { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) } } : {}),
    proxy: {
      // Proxy API requests to the API service.
      // When running inside Docker, VITE_PROXY_API_URL=http://api:8000.
      // When running on the host, falls back to http://localhost:8000.
      '/api': {
        target: process.env.VITE_PROXY_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
      // Proxy WebSocket gateway connections.
      // When running inside Docker, VITE_PROXY_GATEWAY_URL=http://gateway:4000.
      // When running on the host, falls back to http://localhost:4000.
      '/gateway': {
        target: process.env.VITE_PROXY_GATEWAY_URL || 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
      // Proxy the voice-server (mediasoup SFU) signaling WebSocket through the same
      // origin. The voice-server speaks plain ws (no TLS), so on an HTTPS page a direct
      // wss://host:4001 would fail as mixed content / TLS-against-plain-ws. Routing it
      // via /voice shares the page's TLS (like /gateway). Media (UDP/RTP) still flows
      // directly to the voice-server's announced IP and is not proxied.
      '/voice': {
        target: process.env.VITE_PROXY_VOICE_URL || 'http://localhost:4001',
        changeOrigin: true,
        ws: true,
      },
      // Proxy object-storage (MinIO/S3) reads through the same origin. MinIO speaks plain
      // HTTP, so a direct http://host:9000 attachment URL is mixed content on an HTTPS page
      // (and 'localhost' points at the viewer's own machine for remote users). The API
      // stores attachment URLs as /cdn/<bucket>/<key>; strip /cdn and forward to MinIO so
      // links share the page's TLS (like /voice).
      '/cdn': {
        target: process.env.VITE_PROXY_CDN_URL || 'http://localhost:9000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cdn/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['vitest', '@testing-library/react', '@testing-library/jest-dom', '@testing-library/user-event'],
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
});
