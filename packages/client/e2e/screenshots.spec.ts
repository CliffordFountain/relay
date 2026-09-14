import { test, expect, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import { API_BASE, sendMessageViaAPI, loginViaToken, clickFirstGuild } from './helpers';

/**
 * Marketing screenshot capture. Seeds a realistic server + conversation via the API (clean
 * usernames + a real guild name), then drives the client to capture each feature to
 * docs/screenshots/feature-*.png.
 *
 * Run against a live stack with host Chrome:
 *   PLAYWRIGHT_EXECUTABLE_PATH=<chrome> E2E_BASE_URL=https://localhost:5173 \
 *     npx playwright test e2e/screenshots.spec.ts --project=chromium
 *
 * Not a pass/fail test — each capture is best-effort; the summary logs what was produced.
 */

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';
// Playwright runs from packages/client; write to the repo-root docs/screenshots.
const OUT = '../../docs/screenshots';
const VIEWPORT = { width: 1440, height: 900 };

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--auto-select-desktop-capture-source=Entire screen',
      '--auto-accept-this-tab-capture',
    ],
  },
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Register a user with a clean username (falls back to a short suffix if it's taken). */
async function registerClean(request: APIRequestContext, name: string): Promise<{ token: string; username: string; email: string }> {
  for (const uname of [name, `${name}${Math.floor(Math.random() * 900 + 100)}`, `${name}${Date.now().toString(36).slice(-4)}`]) {
    const email = `${uname}_${Date.now().toString(36)}@demo.test`;
    const res = await request.post(`${API_BASE}/auth/register`, {
      data: { username: uname, email, password: 'TestPass123A', date_of_birth: '1995-01-01', consent: true },
    });
    if (res.ok()) {
      const { token } = await res.json() as { token: string };
      return { token, username: uname, email };
    }
  }
  throw new Error(`could not register a clean username for "${name}"`);
}

async function createGuild(request: APIRequestContext, token: string, name: string): Promise<{ guildId: string; channelId: string }> {
  const g = await request.post(`${API_BASE}/guilds`, { data: { name }, headers: auth(token) });
  const { id } = await g.json() as { id: string };
  const ch = await request.get(`${API_BASE}/guilds/${id}/channels`, { headers: auth(token) });
  const channels = await ch.json() as Array<{ id: string; type: number }>;
  const text = channels.find(c => c.type === 0)!;
  return { guildId: id, channelId: text.id };
}

async function joinGuild(request: APIRequestContext, ownerToken: string, guildId: string, memberToken: string): Promise<void> {
  const ch = await request.get(`${API_BASE}/guilds/${guildId}/channels`, { headers: auth(ownerToken) });
  const channels = await ch.json() as Array<{ id: string; type: number }>;
  const text = channels.find(c => c.type === 0)!;
  const inv = await request.post(`${API_BASE}/channels/${text.id}/invites`, { data: { max_uses: 5, max_age: 86400 }, headers: auth(ownerToken) });
  const { code } = await inv.json() as { code: string };
  await request.post(`${API_BASE}/invites/${code}`, { headers: auth(memberToken) });
}

test('capture feature screenshots', async ({ browser, request }) => {
  test.setTimeout(300000);
  const done: string[] = [];
  const shoot = async (page: Page, name: string, locatorSel?: string) => {
    const path = `${OUT}/${name}.png`;
    try {
      if (locatorSel) await page.locator(locatorSel).first().screenshot({ path });
      else await page.screenshot({ path });
      done.push(name);
    } catch (e) {
      console.log(`[skip] ${name}: ${(e as Error).message.split('\n')[0]}`);
    }
  };

  // ── Seed a server + a realistic conversation with clean names ──
  const owner = await registerClean(request, 'maya');
  const { guildId, channelId: cid } = await createGuild(request, owner.token, 'Relay HQ');
  const sam = await registerClean(request, 'sam');
  const leo = await registerClean(request, 'leo');
  await joinGuild(request, owner.token, guildId, sam.token);
  await joinGuild(request, owner.token, guildId, leo.token);

  const react = async (token: string, messageId: string, emoji: string) => {
    await request.put(`${API_BASE}/channels/${cid}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { headers: auth(token) }).catch(() => {});
  };
  const line = (tok: string, text: string) => sendMessageViaAPI(request, tok, cid, text);

  await line(owner.token, 'Welcome to the server! 🎉 This channel is for general chat.');
  await line(sam.token, 'hey everyone 👋 excited to be here');
  await line(leo.token, 'ayy 🔥 finally a chat app we actually own');
  await line(owner.token, 'exactly — self-hosted, our data, our rules. voice + video + screen share all built in.');
  const m5 = await line(sam.token, 'wait it does screen share too? 😮');
  await line(owner.token, 'yep, and you can watch multiple people stream at once and switch between them');
  const m7 = await line(leo.token, 'this is huge. GIF support?');
  await line(sam.token, 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif');
  const m9 = await line(owner.token, 'GIFs, stickers, custom emoji, reactions, threads — the whole thing 💜');
  await line(leo.token, 'okay I am sold. jumping in voice 🎧');

  await react(owner.token, m5.id, '👀');
  await react(leo.token, m5.id, '🔥');
  await react(sam.token, m7.id, '🙌');
  await react(owner.token, m9.id, '💜');
  await react(sam.token, m9.id, '🎉');
  await react(leo.token, m9.id, '🔥');

  const creds = (u: { email: string }) => ({ email: u.email, password: 'TestPass123A' });

  // ── Maya's browser: chat, pickers, gallery, settings ──
  const ctxA: BrowserContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE, viewport: VIEWPORT });
  const a = await ctxA.newPage();
  await loginViaToken(a, owner.token, creds(owner));
  await clickFirstGuild(a);
  const general = a.locator('[role="button"][aria-label="Text channel general"]').first();
  await expect(general).toBeVisible({ timeout: 20000 });
  await general.click();
  await expect(a.locator('textarea[aria-label*="Message" i]')).toBeVisible({ timeout: 20000 });
  await a.waitForTimeout(1500);

  await shoot(a, 'feature-chat');
  await shoot(a, 'feature-reactions', 'div[role="group"][aria-label="Reactions"]');

  const openPanel = async (btn: string, dialog: string, name: string, waitMs = 400) => {
    try {
      await a.getByRole('button', { name: btn }).click();
      await expect(a.locator(dialog)).toBeVisible({ timeout: 8000 });
      await a.waitForTimeout(waitMs);
      await shoot(a, name);
    } catch (e) { console.log(`${name}:`, (e as Error).message.split('\n')[0]); }
  };

  await openPanel('Add Emoji', '[role="dialog"][aria-label="Emoji picker"]', 'feature-emoji-picker');
  await a.keyboard.press('Escape');
  await openPanel('Open sticker picker', '[role="dialog"][aria-label="Sticker picker"]', 'feature-sticker-picker');
  await a.keyboard.press('Escape');
  await openPanel('Open GIF picker', '[role="dialog"][aria-label="GIF picker"]', 'feature-gif-picker', 2500);
  await a.keyboard.press('Escape');

  // Send a few real GIFs (reopen + pick) so the media gallery is fuller.
  for (let i = 0; i < 3; i++) {
    try {
      await a.getByRole('button', { name: 'Open GIF picker' }).click();
      const opts = a.locator('[role="dialog"][aria-label="GIF picker"] [role="option"]');
      await expect(opts.nth(i)).toBeVisible({ timeout: 8000 });
      await opts.nth(i).click(); // sends the GIF and closes the picker
      await a.waitForTimeout(1200);
    } catch (e) { console.log('gif send:', (e as Error).message.split('\n')[0]); }
  }

  // Media gallery (Grid view)
  try {
    await a.getByTitle('Grid view').click();
    await a.waitForTimeout(1500);
    await shoot(a, 'feature-media-gallery');
    await a.getByTitle('List view').click().catch(() => {});
  } catch (e) { console.log('gallery:', (e as Error).message.split('\n')[0]); }

  // Settings → Voice & Video (shows the mic test + Hear myself)
  try {
    await a.locator('[aria-label="User Settings"]').click();
    const dlg = a.locator('[role="dialog"][aria-label="User Settings"]');
    await expect(dlg).toBeVisible({ timeout: 10000 });
    await dlg.getByRole('button', { name: 'Voice & Video' }).click();
    await a.waitForTimeout(600);
    await shoot(a, 'feature-settings-voice');
    await a.keyboard.press('Escape');
  } catch (e) { console.log('settings:', (e as Error).message.split('\n')[0]); }

  // ── Voice / video / screen share (UI shots; video is a synthetic test pattern) ──
  const ctxB: BrowserContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE, viewport: VIEWPORT });
  const b = await ctxB.newPage();
  try {
    await clickFirstGuild(a);
    const voiceA = a.locator('[role="button"][aria-label^="Voice channel"]').first();
    await expect(voiceA).toBeVisible({ timeout: 20000 });
    await voiceA.click();
    const barA = a.getByRole('toolbar', { name: 'Voice controls' });
    await expect(barA).toBeVisible({ timeout: 20000 });
    await barA.getByLabel('Turn On Camera').click();
    await barA.getByLabel('Share Your Screen').click();
    await a.getByRole('button', { name: 'Go Live' }).click();
    await expect(a.getByTestId('stream-stage')).toBeVisible({ timeout: 40000 });

    await loginViaToken(b, sam.token, creds(sam));
    await clickFirstGuild(b);
    const voiceB = b.locator('[role="button"][aria-label^="Voice channel"]').first();
    await expect(voiceB).toBeVisible({ timeout: 20000 });
    await voiceB.click();
    await expect(b.getByRole('toolbar', { name: 'Voice controls' })).toBeVisible({ timeout: 20000 });
    await b.getByRole('toolbar', { name: 'Voice controls' }).getByLabel('Turn On Camera').click().catch(() => {});
    await b.waitForTimeout(4000);

    await shoot(b, 'feature-screen-share');
    await shoot(a, 'feature-voice-call');
  } catch (e) {
    console.log('voice/screen-share:', (e as Error).message.split('\n')[0]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }

  console.log('CAPTURED:', done.join(', '));
  expect(done.length, 'no screenshots captured').toBeGreaterThan(0);
});
