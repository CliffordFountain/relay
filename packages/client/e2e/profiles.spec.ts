import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild, sendMessageViaAPI, enterGeneralChannel,
  apiWithRetry, API_BASE,
} from './helpers';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

// 1x1 PNG as a data URL — how avatars are actually stored.
const AVATAR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

test('a user avatar renders next to their channel message', async ({ browser, request }) => {
  test.setTimeout(150000);
  // Bug: MessageList rendered author avatars as only the username's first letter — it never
  // emitted an <img> for msg.author.avatar (which the API returns as a data: URL).
  const owner = await registerUserWithGuild(request, 'ava');
  // Set the avatar BEFORE sending, so the message's enriched author carries it.
  const patch = await apiWithRetry(request, 'patch', `${API_BASE}/users/@me`, {
    data: { avatar: AVATAR_DATA_URL },
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(patch.ok).toBeTruthy();
  await sendMessageViaAPI(request, owner.token, owner.channelId, 'avatar render test');

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });
    await expect(page.getByText('avatar render test').first()).toBeVisible({ timeout: 20000 });

    // The author avatar must now be an <img> whose src is the stored data URL (message
    // content here is plain text, so the only data: image on screen is the avatar).
    const avatarImg = page.locator('img[src^="data:image/png"]').first();
    await expect(avatarImg).toBeVisible({ timeout: 10000 });
    expect(await avatarImg.getAttribute('src')).toBe(AVATAR_DATA_URL);
  } finally {
    await ctx.close();
  }
});

test('profile banner honours a black accent colour (0), not default accent', async ({ browser, request }) => {
  test.setTimeout(150000);
  // Bugs: saving #000000 sent null (lost), and the display used a truthy check so a stored 0
  // rendered as default accent. Set accent_color=0 via API and confirm the profile banner
  // is actually black.
  const owner = await registerUserWithGuild(request, 'clr');
  const patch = await apiWithRetry(request, 'patch', `${API_BASE}/users/@me`, {
    data: { accent_color: 0 },
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(patch.ok).toBeTruthy();

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });

    // Open the owner's profile: member list → member → popover → View Profile.
    const memberList = page.locator('aside[aria-label="Member list"]');
    await expect(memberList).toBeVisible({ timeout: 20000 });
    await memberList.getByRole('button', { name: new RegExp(`^${owner.username}`) }).first().click();
    await page.getByRole('button', { name: 'View full profile' }).click();

    const banner = page.getByTestId('profile-banner');
    await expect(banner).toBeVisible({ timeout: 10000 });
    const bg = await banner.evaluate((el) => getComputedStyle(el).backgroundColor);
    // black, NOT accent rgb(59, 130, 246)
    expect(bg).toBe('rgb(0, 0, 0)');
  } finally {
    await ctx.close();
  }
});
