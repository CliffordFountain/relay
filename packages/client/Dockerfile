FROM node:22-alpine

# Install Chromium for Playwright E2E tests (uses Alpine's native musl-based build)
RUN apk add --no-cache chromium

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

EXPOSE 5173

# Always run pnpm install on start (the named volume for node_modules persists it across restarts)
# After first successful install, subsequent starts are near-instant (nothing to install)
# Also fetch Playwright's ffmpeg (video recorder for E2E) once deps are installed; `|| true` so it never blocks app start.
CMD ["sh", "-c", "cd /app && CI=true pnpm install --no-frozen-lockfile && (npx playwright install ffmpeg || true) && cd packages/client && exec pnpm dev --host 0.0.0.0"]
