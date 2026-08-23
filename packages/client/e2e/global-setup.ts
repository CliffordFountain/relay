/**
 * Global setup for E2E tests.
 * Clears ALL rate limit keys from Redis to ensure tests can register users.
 * Also clears any session-related keys that might interfere with fresh test runs.
 *
 * Supports running from:
 *   - Host machine (uses `docker exec relay-redis redis-cli ...`)
 *   - Inside Docker container (uses direct TCP connection to redis:6379)
 *
 * IMPORTANT: Rate limits are cleared BEFORE the warmup so that guild creation
 * during warmup succeeds. Guild creation failure causes warmup to only compile
 * the DM view, leaving ChannelList/MessageList uncompiled and causing 60s+
 * cold-compile delays in the first channels/messages test.
 */

import { execSync } from 'child_process';
import { createConnection } from 'net';
import { chromium } from '@playwright/test';

function clearRedisKeysViaTcp(host: string, port: number, pattern: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port }, () => {
      const luaScript = `local keys = redis.call('keys','${pattern}') for i=1,#keys do redis.call('del',keys[i]) end return #keys`;
      const cmd = `EVAL "${luaScript}" 0\r\n`;
      socket.write(cmd);
    });

    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      socket.end();
    });

    socket.on('end', () => {
      // Redis returns ":N\r\n" for integer responses
      const match = /:(\d+)/.exec(data);
      resolve(match ? match[1] : '0');
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('TCP timeout'));
    });
  });
}

/**
 * Clear all rate limit keys from Redis. Returns true if successful.
 * Tries docker exec first (host machine), then direct TCP (inside Docker).
 */
async function clearRateLimits(): Promise<boolean> {
  // Try docker exec first (works from host)
  try {
    const cmd = `docker exec relay-redis redis-cli EVAL "local keys = redis.call('keys','ratelimit*') for i=1,#keys do redis.call('del',keys[i]) end return #keys" 0`;
    const result = execSync(cmd, { stdio: 'pipe', timeout: 10000 });
    const deleted = result.toString().trim();
    // eslint-disable-next-line no-console
    console.log(`[global-setup] Cleared ${deleted} rate limit key(s) from Redis via docker exec`);
    // Also clear rate_limit:* pattern
    try {
      const cmd2 = `docker exec relay-redis redis-cli EVAL "local keys = redis.call('keys','rate_limit*') for i=1,#keys do redis.call('del',keys[i]) end return #keys" 0`;
      execSync(cmd2, { stdio: 'pipe', timeout: 10000 });
    } catch {
      // Ignore secondary pattern failure
    }
    return true;
  } catch {
    // docker exec not available, try TCP
  }

  // Fall back to direct TCP connection (works from inside Docker)
  for (const host of ['redis', 'localhost']) {
    try {
      const deleted = await clearRedisKeysViaTcp(host, 6379, 'ratelimit*');
      // eslint-disable-next-line no-console
      console.log(`[global-setup] Cleared ${deleted} rate limit key(s) from Redis via TCP (${host})`);
      await clearRedisKeysViaTcp(host, 6379, 'rate_limit*').catch(() => { /* ignore */ });
      return true;
    } catch {
      // Try next host
    }
  }

  // eslint-disable-next-line no-console
  console.warn('[global-setup] Warning: Could not clear rate limit keys from Redis');
  return false;
}

// When running inside Docker, use the service name. Otherwise use localhost.
function detectApiBaseUrl(): string {
  if (process.env.E2E_API_BASE) return process.env.E2E_API_BASE;
  try {
    require('fs').accessSync('/.dockerenv');
    return 'http://api:8000/api/v10';
  } catch {
    return 'http://localhost:8000/api/v10';
  }
}
const API_BASE_URL = detectApiBaseUrl();

/**
 * Register a temporary user and create a guild. Returns the auth token.
 * Having a guild forces the full app (ServerList + ChannelList + MessageList)
 * to render, which triggers compilation of ALL heavy components in Vite.
 * Rate limits must be cleared before calling this.
 */
async function registerWarmupUser(): Promise<string | null> {
  try {
    const id = Math.random().toString(36).slice(2, 10);
    const regRes = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `warmup_${id}`,
        email: `warmup_${id}@warmup.test`,
        password: 'WarmupPass123A',
        date_of_birth: '1995-01-01',
        consent: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!regRes.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[global-setup] Warmup registration failed: ${regRes.status}`);
      return null;
    }
    const { token } = await regRes.json() as { token: string };
    if (!token) return null;

    // Create a guild so the app navigates to a channel view and compiles
    // ChannelList + MessageList (the heaviest lazy-compiled components).
    const guildRes = await fetch(`${API_BASE_URL}/guilds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `WarmupGuild_${id}` }),
      signal: AbortSignal.timeout(15000),
    });
    if (!guildRes.ok) {
      // Guild creation failed — log a warning, the warmup will only compile DM view
      // eslint-disable-next-line no-console
      console.warn(`[global-setup] Warmup guild creation failed: ${guildRes.status} — channel view will NOT be pre-compiled`);
    }

    return token;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[global-setup] Warmup user creation error:', err);
    return null;
  }
}

/**
 * Warm up the Vite dev server by opening a real browser page WITH an authenticated
 * session. This forces Vite to lazily compile ALL app components (ServerList,
 * ChannelList, MessageList, etc.), not just the login page. Without this,
 * the first test that loads the full authenticated app pays a 30-60s compilation
 * penalty.
 *
 * Rate limits MUST be cleared before calling this function.
 */
async function warmupVite(baseURL: string, maxWaitMs = 120000): Promise<void> {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    // First, navigate to the app without a token so the HTML/JS infrastructure loads
    await page.goto(baseURL, { timeout: 30000 }).catch(() => { /* ignore */ });

    // Try to get an auth token to load the full authenticated app
    const token = await registerWarmupUser();

    if (token) {
      // Set token in localStorage so useStartupLoader runs the full startup flow
      await page.evaluate((t: string) => { localStorage.setItem('token', t); }, token);
      await page.reload({ waitUntil: 'domcontentloaded' });

      // Wait for the full app to render: server sidebar first, then the message input.
      // This triggers compilation of ServerList + ChannelList + MessageList + MessageInput.
      const serverNavFound = await page.locator('nav[aria-label="Servers"]')
        .waitFor({ state: 'attached', timeout: maxWaitMs })
        .then(() => true)
        .catch(() => false);

      if (!serverNavFound) {
        // eslint-disable-next-line no-console
        console.warn('[global-setup] Warmup: server sidebar did not appear — Vite compilation may be incomplete');
      }

      // Wait for the message textarea: proves ChannelList + MessageList + MessageInput are compiled.
      const textareaFound = await page.locator('textarea[aria-label*="Message"]')
        .waitFor({ state: 'attached', timeout: 60000 })
        .then(() => true)
        .catch(() => false);

      if (textareaFound) {
        // eslint-disable-next-line no-console
        console.log('[global-setup] Vite dev server warmed up (full channel view compiled)');
      } else {
        // eslint-disable-next-line no-console
        console.warn('[global-setup] Vite dev server warmed up (channel view NOT compiled — guild may have no channels)');
      }
    } else {
      // API not reachable yet — wait for login page at minimum
      await page.locator('h1:has-text("Welcome back")').waitFor({ state: 'attached', timeout: 30000 })
        .catch(() => { /* timeout — proceed anyway */ });
      // eslint-disable-next-line no-console
      console.log('[global-setup] Vite dev server warmed up (login page only — API unavailable)');
    }
  } catch {
    // Ignore errors (server unreachable, etc.) — tests will handle it themselves
  } finally {
    await browser.close();
  }
}

export default async function globalSetup() {
  // IMPORTANT: Clear rate limits FIRST, before warmup.
  // Guild creation during warmup needs rate limits cleared to succeed.
  // If guild creation fails, warmup only compiles DM view — not the heavy
  // ChannelList/MessageList components — causing 60s+ delays in channels tests.
  await clearRateLimits();

  // Warm up Vite dev server to avoid first-test cold-compile delay.
  // Rate limits are already cleared so guild creation during warmup will succeed.
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  await warmupVite(baseURL).catch(() => { /* ignore if unreachable */ });
}
