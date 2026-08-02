FROM node:22-alpine

RUN apk add --no-cache python3 py3-pip make g++ linux-headers meson ninja curl
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
# Install deps - onlyBuiltDependencies in package.json allows mediasoup/esbuild postinstall
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install
# Explicitly build mediasoup worker binary in case postinstall was skipped
RUN node node_modules/.pnpm/mediasoup@3.19.19/node_modules/mediasoup/npm-scripts.mjs postinstall 2>&1 || true

COPY . .

EXPOSE 4001

CMD ["sh", "-c", "CI=true pnpm install --no-frozen-lockfile && pnpm dev"]
