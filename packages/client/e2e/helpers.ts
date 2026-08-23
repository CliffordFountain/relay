import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { execSync } from 'child_process';
import { accessSync } from 'fs';
import { createConnection } from 'net';

// Detect whether running inside Docker (container has /.dockerenv) or on host
function detectApiBase(): string {
  if (process.env.E2E_API_BASE) return process.env.E2E_API_BASE;
  try {
    accessSync('/.dockerenv');
    return 'http://api:8000/api/v10';
  } catch {
    return 'http://localhost:8000/api/v10';
  }
}

export const API_BASE = detectApiBase();

/** Short unique suffix (max 8 chars) to keep usernames under 32 chars. */
export function uniqueId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Clear all rate limit keys from Redis via direct TCP connection.
 * Works both from the host (connecting to localhost:6379) and from
 * inside Docker (connecting to redis:6379).
 */
function clearRateLimitsViaTcp(host: string, port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      const luaScript = "local keys = redis.call('keys','ratelimit*') for i=1,#keys do redis.call('del',keys[i]) end return #keys";
      const cmd = `EVAL "${luaScript}" 0\r\n`;
      socket.write(cmd);
    });

    socket.on('data', () => {
      socket.end();
      resolve();
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(); // Silently ignore connection errors
    });

    // Timeout after 3 seconds
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve();
    });
  });
}

/** Clear all rate limit keys from Redis. Call before registering users. */
export function clearRateLimits(): void {
  // Try docker exec first (works from host)
  try {
    execSync(
      `docker exec relay-redis redis-cli EVAL "local keys = redis.call('keys','ratelimit*') for i=1,#keys do redis.call('del',keys[i]) end return #keys" 0`,
      { stdio: 'pipe', timeout: 10000 },
    );
    return;
  } catch {
    // docker exec not available - fall through to TCP approach
  }

  // Fall back to direct TCP connection (works from inside Docker)
  // Try both 'redis' hostname (Docker network) and 'localhost' (host)
  void clearRateLimitsViaTcp('redis', 6379).catch(() =>
    clearRateLimitsViaTcp('localhost', 6379),
  );
}

/**
 * Makes an API request with automatic retry on rate limit (429).
 * On 429, clears Redis rate limits and retries.
 */
export async function apiWithRetry(
  request: APIRequestContext,
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  url: string,
  options?: { data?: unknown; headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Awaited<ReturnType<APIRequestContext['get']>>;

    if (method === 'get') {
      res = await request.get(url, { headers: options?.headers });
    } else if (method === 'post') {
      res = await request.post(url, { data: options?.data, headers: options?.headers });
    } else if (method === 'patch') {
      res = await request.patch(url, { data: options?.data, headers: options?.headers });
    } else if (method === 'put') {
      res = await request.put(url, { data: options?.data, headers: options?.headers });
    } else {
      res = await request.delete(url, { headers: options?.headers });
    }

    if (res.status() === 429 && attempt < maxRetries) {
      clearRateLimits();
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    return {
      ok: res.ok(),
      status: res.status(),
      json: () => res.json(),
    };
  }

  throw new Error(`API request to ${url} failed after ${maxRetries} retries`);
}

export interface UserFixture {
  token: string;
  username: string;
  email: string;
}

export interface GuildFixture {
  token: string;
  username: string;
  email: string;
  guildId: string;
  guildName: string;
  channelId: string;
}

export interface VoiceFixture {
  token: string;
  username: string;
  email: string;
  guildId: string;
  voiceChannelId: string;
}

/** Register a fresh user via API and return credentials. */
export async function registerUser(request: APIRequestContext, prefix = 'e2e'): Promise<UserFixture> {
  clearRateLimits();
  const id = uniqueId();
  const username = `${prefix}_${id}`;
  const email = `${prefix}_${id}@test.com`;

  const res = await apiWithRetry(request, 'post', `${API_BASE}/auth/register`, {
    data: { username, email, password: 'TestPass123A', date_of_birth: '1995-01-01', consent: true },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Registration failed (${res.status}): ${JSON.stringify(body)}`);
  }

  const data = await res.json() as { token: string };
  return { token: data.token, username, email };
}

/** Register a user and create a guild with default channels. */
export async function registerUserWithGuild(request: APIRequestContext, prefix = 'e2e'): Promise<GuildFixture> {
  const user = await registerUser(request, prefix);
  const guildName = `TestGuild_${uniqueId()}`;

  const guildRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds`, {
    data: { name: guildName },
    headers: { Authorization: `Bearer ${user.token}` },
  });

  if (!guildRes.ok) {
    throw new Error(`Guild creation failed (${guildRes.status})`);
  }

  const guildData = await guildRes.json() as { id: string };

  const chRes = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${guildData.id}/channels`, {
    headers: { Authorization: `Bearer ${user.token}` },
  });

  if (!chRes.ok) {
    throw new Error(`Channels fetch failed (${chRes.status})`);
  }

  const channels = await chRes.json() as Array<{ id: string; type: number }>;
  const textChannel = channels.find(c => c.type === 0);

  if (!textChannel) {
    throw new Error('No text channel found in guild');
  }

  return {
    token: user.token,
    username: user.username,
    email: user.email,
    guildId: guildData.id,
    guildName,
    channelId: textChannel.id,
  };
}

/** Register a user with a guild that has a voice channel. */
export async function registerUserWithVoice(request: APIRequestContext, prefix = 'voice'): Promise<VoiceFixture> {
  const user = await registerUser(request, prefix);

  const guildRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds`, {
    data: { name: `VoiceGuild_${uniqueId()}` },
    headers: { Authorization: `Bearer ${user.token}` },
  });
  if (!guildRes.ok) throw new Error('Guild creation failed');
  const guildData = await guildRes.json() as { id: string };

  const vcRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${guildData.id}/channels`, {
    data: { name: 'voice-test', type: 2 },
    headers: { Authorization: `Bearer ${user.token}` },
  });
  if (!vcRes.ok) throw new Error('Voice channel creation failed');
  const vcData = await vcRes.json() as { id: string };

  return {
    token: user.token,
    username: user.username,
    email: user.email,
    guildId: guildData.id,
    voiceChannelId: vcData.id,
  };
}

/**
 * Wait for the app to finish its startup sequence. The app is "done loading" when
 * one of these DOM states appears:
 *   - The server sidebar nav with aria-label="Servers" (authenticated, app rendered)
 *   - An h1 containing "Welcome back" (login page shown, token was invalid/expired)
 *   - An input[type="email"] (auth form rendered)
 *
 * Returns 'app' if the server sidebar appeared, 'login' otherwise.
 */
async function waitForAppOrLogin(page: Page, timeout = 60000): Promise<'app' | 'login'> {
  // Use Promise.race between the two selectors. This avoids the pitfalls of
  // waitForFunction polling (which can miss transient states).
  const appLocator = page.locator('nav[aria-label="Servers"]');
  const loginLocator = page.locator('h1:has-text("Welcome back")');

  const result = await Promise.race([
    appLocator.waitFor({ state: 'visible', timeout }).then(() => 'app' as const),
    loginLocator.waitFor({ state: 'visible', timeout }).then(() => 'login' as const),
  ]).catch(() => null);

  if (result === null) {
    // Last-chance check: maybe the page loaded but our selectors were wrong
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) ?? '');
    throw new Error(
      `App did not load within ${timeout}ms. Neither server sidebar nor login page appeared. ` +
      `Body text: ${bodyText}`,
    );
  }

  return result;
}

/**
 * Set token in localStorage and navigate to app root. Waits for the app to finish
 * loading (either server sidebar or login page). Uses up to 3 attempts with rate
 * limit clearing between each attempt. Falls back to UI login if credentials are
 * provided and token validation keeps failing.
 */
export async function loginViaToken(
  page: Page,
  token: string,
  credentials?: { email: string; password: string },
): Promise<void> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    clearRateLimits();

    if (attempt === 1) {
      // First attempt: navigate to the app and set token
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    }

    await page.evaluate((t: string) => {
      localStorage.setItem('token', t);
    }, token);

    // Small delay to let rate limit clearing take effect
    if (attempt > 1) {
      await page.waitForTimeout(1000);
    }

    await page.reload({ waitUntil: 'load' });

    const outcome = await waitForAppOrLogin(page);

    if (outcome === 'app') {
      return;
    }

    // Token validation failed (rate limit or invalid token) -- login page appeared.
    // On last attempt, fall back to UI login if credentials are provided.
    if (attempt === maxAttempts && credentials) {
      clearRateLimits();
      await page.getByLabel(/email/i).first().fill(credentials.email);
      await page.getByLabel(/password/i).fill(credentials.password);
      await page.getByRole('button', { name: /log in/i }).click();
      await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible({ timeout: 60000 });
      return;
    }

    // Not the last attempt -- clear rate limits and retry with token
  }

  throw new Error(
    'loginViaToken failed: token validation failed after all attempts and no credentials were provided for fallback login.',
  );
}

/** Click the first non-Home guild in the server sidebar. */
export async function clickFirstGuild(page: Page): Promise<void> {
  const nav = page.locator('nav[aria-label="Servers"]');
  await expect(nav).toBeVisible({ timeout: 10000 });

  // Guild items use role="treeitem" with aria-label set to the guild name.
  // Wait for at least one non-Home treeitem to appear (guilds load async during startup).
  const guildItem = nav.locator('[role="treeitem"]:not([aria-label="Home"])').first();
  await expect(guildItem).toBeVisible({ timeout: 15000 });

  // Always click the guild to ensure the channel list is rendered.
  // Even if already selected, the channel list may not be visible yet after a fresh page load.
  await guildItem.click({ timeout: 10000 });
}

/** Navigate into a guild's #general text channel and wait for the message input. */
export async function enterGeneralChannel(page: Page, token: string, credentials?: { email: string; password: string }): Promise<void> {
  await loginViaToken(page, token, credentials);
  await clickFirstGuild(page);

  // Wait for the channel navigation sidebar to be fully rendered before attempting to click.
  // This avoids "detached from DOM" races when React re-renders the channel list.
  await expect(page.locator('nav[aria-label$="(server)"]')).toBeVisible({ timeout: 15000 });

  // Channel buttons use aria-label like "Text channel general".
  // Retry the click up to 3 times to handle transient detach-from-DOM during React re-renders.
  const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
  await expect(generalChannel).toBeVisible({ timeout: 15000 });
  // Pause to let React re-renders settle before clicking
  await page.waitForTimeout(500);
  let clicked = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await generalChannel.click({ timeout: 5000 });
      clicked = true;
      break;
    } catch {
      if (attempt === 2) {
        // After 3 failures, try reloading the page to recover from stale Vite state
        clearRateLimits();
        await page.reload({ waitUntil: 'load' });
        await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible({ timeout: 15000 });
        await clickFirstGuild(page);
        await expect(page.locator('nav[aria-label$="(server)"]')).toBeVisible({ timeout: 15000 });
        await expect(generalChannel).toBeVisible({ timeout: 15000 });
      }
      await page.waitForTimeout(1000);
    }
  }
  if (!clicked) {
    // Last resort: force click
    await generalChannel.click({ force: true, timeout: 10000 });
  }

  // Wait for message input (textarea with aria-label containing "Message")
  await expect(page.locator('textarea[aria-label*="Message"]')).toBeVisible({ timeout: 15000 });
}

/** Send a message in the currently open channel and wait for it to appear. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('textarea[aria-label*="Message"]');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByText(text)).toBeVisible({ timeout: 10000 });
}

/** Create a guild via the UI "Add a Server" flow. */
export async function createGuildViaUI(page: Page, name: string): Promise<void> {
  // Click the "Add a Server" button in the server sidebar
  const addBtn = page.locator('nav[aria-label="Servers"] [role="button"][aria-label="Add a Server"]');
  await addBtn.click();

  // Wait for Create Guild dialog (aria-label="Create a server")
  await expect(page.locator('[role="dialog"][aria-label="Create a server"]')).toBeVisible({ timeout: 10000 });

  // Wait for the name input (the modal opens straight on the name form).
  await expect(page.locator('#server-name')).toBeVisible({ timeout: 5000 });

  // Fill in the server name (input with id="server-name")
  await page.locator('#server-name').fill(name);

  // Click "Create" button (type="submit" with text "Create")
  await page.locator('[role="dialog"] button[type="submit"]').click();

  // Wait for dialog to close
  await expect(page.locator('[role="dialog"][aria-label="Create a server"]')).not.toBeVisible({ timeout: 10000 });

  // Wait for the guild to appear in the sidebar (guild items use role="treeitem")
  await expect(page.locator(`nav[aria-label="Servers"] [role="treeitem"][aria-label="${name}"]`)).toBeVisible({ timeout: 10000 });
}

/** Create a role via API and return the role data. */
export async function createRole(
  request: APIRequestContext,
  token: string,
  guildId: string,
  data: { name: string; permissions?: string; color?: number; hoist?: boolean; mentionable?: boolean },
): Promise<{ id: string; name: string; permissions: string }> {
  const res = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${guildId}/roles`, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Role creation failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return await res.json() as { id: string; name: string; permissions: string };
}

/** Add a role to a guild member via API. */
export async function addRoleToMember(
  request: APIRequestContext,
  token: string,
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const res = await apiWithRetry(request, 'put', `${API_BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Add role to member failed (${res.status})`);
  }
}

/** Send a message via API and return the message data. */
export async function sendMessageViaAPI(
  request: APIRequestContext,
  token: string,
  channelId: string,
  content: string,
): Promise<{ id: string; content: string }> {
  const res = await apiWithRetry(request, 'post', `${API_BASE}/channels/${channelId}/messages`, {
    data: { content },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Send message failed (${res.status})`);
  }
  return await res.json() as { id: string; content: string };
}

/** Get the current user's ID from /users/@me */
export async function getCurrentUserId(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const res = await apiWithRetry(request, 'get', `${API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Get current user failed (${res.status})`);
  }
  const data = await res.json() as { id: string };
  return data.id;
}

/** Add a second member to a guild (register + join via invite). */
export async function addMemberToGuild(
  request: APIRequestContext,
  ownerToken: string,
  guildId: string,
  memberPrefix = 'member',
): Promise<UserFixture & { userId: string }> {
  const member = await registerUser(request, memberPrefix);
  const memberId = await getCurrentUserId(request, member.token);

  // Get a channel for the guild to create the invite on
  const chRes = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  if (!chRes.ok) {
    throw new Error(`Failed to get guild channels (${chRes.status})`);
  }
  const channels = await chRes.json() as Array<{ id: string; type: number }>;
  const textChannel = channels.find(c => c.type === 0);
  if (!textChannel) {
    throw new Error('No text channel found in guild for invite creation');
  }

  // Create an invite on the channel
  const inviteRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${textChannel.id}/invites`, {
    data: { max_uses: 1, max_age: 86400 },
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  if (!inviteRes.ok) {
    throw new Error(`Failed to create invite (${inviteRes.status})`);
  }
  const inviteData = await inviteRes.json() as { code: string };

  // Accept the invite as the new member
  const acceptRes = await apiWithRetry(request, 'post', `${API_BASE}/invites/${inviteData.code}`, {
    headers: { Authorization: `Bearer ${member.token}` },
  });
  if (!acceptRes.ok) {
    throw new Error(`Failed to accept invite (${acceptRes.status})`);
  }

  return { ...member, userId: memberId };
}

/** Click the server header to open the dropdown menu. */
export async function openServerDropdown(page: Page): Promise<void> {
  // The server header has aria-label ending in "server options"
  const serverHeader = page.locator('[aria-label$="server options"]').first();
  await serverHeader.click();

  // Wait for the dropdown menu to appear (role="menu")
  await expect(page.locator('[role="menu"]')).toBeVisible({ timeout: 5000 });
}
