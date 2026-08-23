import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild, sendMessageViaAPI, enterGeneralChannel,
  apiWithRetry, API_BASE,
} from './helpers';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const authH = (t: string) => ({ Authorization: `Bearer ${t}` });

test('a custom emoji reaction renders as an <img> from /cdn and decodes', async ({ browser, request }) => {
  test.setTimeout(150000);
  // Regression: custom emoji reactions rendered a broken image (emojis/{id}.png 404 +
  // cdnBase host mismatch). They now load same-origin via /cdn/relay-emojis/{id}.png.
  const owner = await registerUserWithGuild(request, 'rxc');
  const emoji = await (await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/emojis`, {
    data: { name: 'blobcat', image: IMG }, headers: authH(owner.token),
  })).json() as { id: string; name: string };
  const msg = await sendMessageViaAPI(request, owner.token, owner.channelId, 'react custom please');
  const enc = encodeURIComponent(`${emoji.name}:${emoji.id}`);
  const react = await apiWithRetry(request, 'put', `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${enc}/@me`, { headers: authH(owner.token) });
  expect(react.ok).toBeTruthy();

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });
    const reactions = page.getByRole('group', { name: 'Reactions' });
    await expect(reactions).toBeVisible({ timeout: 15000 });
    const img = reactions.locator(`img[src*="/cdn/relay-emojis/${emoji.id}"]`).first();
    await expect(img).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10000 })
      .toBeGreaterThan(0);
  } finally {
    await ctx.close();
  }
});

test('a unicode reaction displays as its glyph, not a broken image', async ({ browser, request }) => {
  test.setTimeout(150000);
  // The API serializes EVERY reaction emoji as an object: unicode as { name: "👍", id: null }.
  // The renderer keyed on typeof===object to mean "custom", so unicode reactions rendered as
  // <img src=.../emojis/null.png> (a broken image) and the click key became "👍:null". It must
  // render the 👍 glyph and key on "👍".
  const owner = await registerUserWithGuild(request, 'rxu');
  const msg = await sendMessageViaAPI(request, owner.token, owner.channelId, 'react to me please');

  const enc = encodeURIComponent('👍');
  const put = await apiWithRetry(
    request, 'put',
    `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${enc}/@me`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(put.ok).toBeTruthy();

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });

    const reactions = page.getByRole('group', { name: 'Reactions' });
    await expect(reactions).toBeVisible({ timeout: 15000 });

    // The glyph is shown as text...
    await expect(reactions.getByText('👍')).toBeVisible({ timeout: 10000 });
    // ...NOT as a broken custom-emoji <img src=.../emojis/null.*>.
    await expect(page.locator('img[src*="/emojis/null"]')).toHaveCount(0);
    // And the pill's accessible name uses the clean key "👍 1" (not "👍:null 1"),
    // which also proves the click-to-toggle key is correct.
    await expect(reactions.getByRole('button', { name: /^👍 1/ })).toBeVisible({ timeout: 10000 });
  } finally {
    await ctx.close();
  }
});
