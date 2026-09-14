import { test, expect, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  registerUserWithGuild,
  addMemberToGuild,
  sendMessageViaAPI,
  loginViaToken,
  clickFirstGuild,
} from './helpers';

/**
 * Marketing screenshot capture. Seeds a realistic server + conversation via the API, then
 * drives the real client to capture each feature to docs/screenshots/feature-*.png.
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

async function react(request: APIRequestContext, token: string, channelId: string, messageId: string, emoji: string) {
  await request.put(`${API_BASE}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

test('capture feature screenshots', async ({ browser, request }) => {
  test.setTimeout(300000);
  const done: string[] = [];
  const shoot = async (page: Page, name: string, locatorSel?: string) => {
    const path = `${OUT}/${name}.png`;
    try {
      if (locatorSel) {
        await page.locator(locatorSel).first().screenshot({ path });
      } else {
        await page.screenshot({ path });
      }
      done.push(name);
    } catch (e) {
      console.log(`[skip] ${name}: ${(e as Error).message.split('\n')[0]}`);
    }
  };

  // ── Seed a server + a realistic conversation ──
  const owner = await registerUserWithGuild(request, 'maya');   // Maya (owner)
  const sam = await addMemberToGuild(request, owner.token, owner.guildId, 'sam');
  const leo = await addMemberToGuild(request, owner.token, owner.guildId, 'leo');
  const cid = owner.channelId;

  const line = (tok: string, text: string) => sendMessageViaAPI(request, tok, cid, text);
  await line(owner.token, 'Welcome to the server! 🎉 This channel is for general chat.');
  await line(sam.token, 'hey everyone 👋 excited to be here');
  await line(leo.token, 'ayy 🔥 finally a Discord we actually own');
  await line(owner.token, 'exactly — self-hosted, our data, our rules. voice + video + screen share all built in.');
  const m5 = await line(sam.token, 'wait it does screen share too? 😮');
  await line(owner.token, 'yep, and you can watch multiple people stream at once and switch between them');
  const m7 = await line(leo.token, 'this is huge. GIF support?');
  await line(sam.token, 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif');
  const m9 = await line(owner.token, 'GIFs, stickers, custom emoji, reactions, threads — the whole thing 💜');
  await line(leo.token, 'okay I am sold. jumping in voice 🎧');

  // reactions from other members
  await react(request, owner.token, cid, m5.id, '👀');
  await react(request, leo.token, cid, m5.id, '🔥');
  await react(request, sam.token, cid, m7.id, '🙌');
  await react(request, owner.token, cid, m9.id, '💜');
  await react(request, sam.token, cid, m9.id, '🎉');
  await react(request, leo.token, cid, m9.id, '🔥');
  // (the default guild already has a "General" voice channel for the call shots)

  const creds = (u: { email: string }) => ({ email: u.email, password: 'TestPass123A' });

  // ── Maya's browser: chat, pickers, gallery, settings ──
  const ctxA: BrowserContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE, viewport: VIEWPORT });
  const a = await ctxA.newPage();
  try {
    await loginViaToken(a, owner.token, creds(owner));
    await clickFirstGuild(a);
    // Open the #general TEXT channel (exact label — "general" also matches the voice channel).
    const general = a.locator('[role="button"][aria-label="Text channel general"]').first();
    await expect(general).toBeVisible({ timeout: 20000 });
    await general.click();
    await expect(a.locator('textarea[aria-label*="Message" i]')).toBeVisible({ timeout: 20000 });
    await a.waitForTimeout(1500); // let messages + GIF settle

    await shoot(a, 'feature-chat');

    // Reactions close-up (the message row that has the reaction pills).
    await shoot(a, 'feature-reactions', 'div[role="group"][aria-label="Reactions"]');

    // Emoji picker
    try {
      await a.getByRole('button', { name: 'Add Emoji' }).click();
      await expect(a.locator('[role="dialog"][aria-label="Emoji picker"]')).toBeVisible({ timeout: 8000 });
      await a.waitForTimeout(400);
      await shoot(a, 'feature-emoji-picker');
      await a.keyboard.press('Escape');
    } catch (e) { console.log('emoji picker:', (e as Error).message.split('\n')[0]); }

    // Sticker picker
    try {
      await a.getByRole('button', { name: 'Open sticker picker' }).click();
      await expect(a.locator('[role="dialog"][aria-label="Sticker picker"]')).toBeVisible({ timeout: 8000 });
      await a.waitForTimeout(400);
      await shoot(a, 'feature-sticker-picker');
      await a.keyboard.press('Escape');
    } catch (e) { console.log('sticker picker:', (e as Error).message.split('\n')[0]); }

    // GIF picker (needs GIPHY key + network — best effort)
    try {
      await a.getByRole('button', { name: 'Open GIF picker' }).click();
      await expect(a.locator('[role="dialog"][aria-label="GIF picker"]')).toBeVisible({ timeout: 8000 });
      await a.waitForTimeout(2500); // let results load if online
      await shoot(a, 'feature-gif-picker');
      await a.keyboard.press('Escape');
    } catch (e) { console.log('gif picker:', (e as Error).message.split('\n')[0]); }

    // Media gallery (Grid view)
    try {
      await a.getByTitle('Grid view').click();
      await a.waitForTimeout(1200);
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
  } finally {
    // keep ctxA open for the voice shots below (Maya will join voice)
  }

  // ── Voice / video / screen share: Maya + Sam in the voice channel ──
  const ctxB: BrowserContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE, viewport: VIEWPORT });
  const b = await ctxB.newPage();
  try {
    // Maya joins voice and goes live (camera + screen share).
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

    // Sam joins voice and watches the stream.
    await loginViaToken(b, sam.token, creds(sam));
    await clickFirstGuild(b);
    const voiceB = b.locator('[role="button"][aria-label^="Voice channel"]').first();
    await expect(voiceB).toBeVisible({ timeout: 20000 });
    await voiceB.click();
    await expect(b.getByRole('toolbar', { name: 'Voice controls' })).toBeVisible({ timeout: 20000 });
    // Sam turns camera on too, so the call shows a live video tile.
    await b.getByRole('toolbar', { name: 'Voice controls' }).getByLabel('Turn On Camera').click().catch(() => {});
    await b.waitForTimeout(4000); // let the stream + camera tiles render frames

    // Watcher view: stream on the stage + participant tiles.
    await shoot(b, 'feature-screen-share');

    // Grid of participants (the video-call view) from Maya's side.
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
