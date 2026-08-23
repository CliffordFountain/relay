import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild,
  addMemberToGuild,
  sendMessageViaAPI,
  enterGeneralChannel,
  apiWithRetry,
  API_BASE,
  uniqueId,
} from './helpers';

/**
 * A profile/name change must propagate LIVE (no reload) to the denormalized name caches
 * on other members' clients: message authors and the member list. This exercises the
 * full path — API refreshes auth:user:{id}:data + publishes USER_UPDATE to shared guilds
 * -> gateway fan-out -> the client's updateAuthorIdentity / updateMemberUser reducers.
 */

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

test('a member renaming themselves updates their name live on other clients', async ({ browser, request }) => {
  test.setTimeout(150000);

  // Owner + a shared guild; Bob joins it and posts a message so his name is on screen.
  const owner = await registerUserWithGuild(request, 'nmowner');
  const bob = await addMemberToGuild(request, owner.token, owner.guildId, 'bob');
  await sendMessageViaAPI(request, bob.token, owner.channelId, 'hello from bob');

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });

    // Owner sees Bob's current name on his message.
    await expect(page.getByText(bob.username).first()).toBeVisible({ timeout: 20000 });

    // Bob renames himself via the same endpoint the settings UI uses.
    const newName = `renamed${uniqueId()}`;
    const res = await apiWithRetry(request, 'patch', `${API_BASE}/users/@me`, {
      data: { username: newName, global_name: newName },
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.ok).toBeTruthy();

    // Owner's client updates the message author LIVE — no reload.
    await expect(page.getByText(newName).first()).toBeVisible({ timeout: 20000 });
    // And the old name is gone from the view (message author + member list).
    await expect(page.getByText(bob.username, { exact: true })).toHaveCount(0, { timeout: 20000 });
  } finally {
    await ctx.close();
  }
});
