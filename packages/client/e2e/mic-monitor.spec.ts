import { test, expect } from '@playwright/test';
import { registerUserWithVoice, loginViaToken } from './helpers';

/**
 * End-to-end proof of the mic-test "Hear myself" monitor: it pipes the captured mic
 * back to a hidden <audio> sink, muted until the box is ticked. Uses Chromium fake-media
 * flags so getUserMedia yields a synthetic mic with no prompt.
 */

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

test.describe('Mic test — hear-myself monitor', () => {
  test('pipes the mic to a playback sink only while the box is ticked', async ({ browser, request }) => {
    test.setTimeout(120000);
    const user = await registerUserWithVoice(request, 'mic');
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
    try {
      const page = await ctx.newPage();
      await loginViaToken(page, user.token, { email: user.email, password: 'TestPass123A' });

      // Open User Settings → Voice & Video.
      await page.locator('[aria-label="User Settings"]').click();
      const dialog = page.locator('[role="dialog"][aria-label="User Settings"]');
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await dialog.getByRole('button', { name: 'Voice & Video' }).click();

      // Start the mic test (fake mic auto-granted).
      await dialog.getByTestId('mic-test-toggle').click();

      const monitorState = () => page.evaluate(() => {
        const a = document.querySelector('[data-testid="mic-monitor-audio"]') as HTMLAudioElement | null;
        const s = a?.srcObject as MediaStream | null;
        const tracks = s?.getAudioTracks?.() ?? [];
        return { present: Boolean(a), muted: a ? a.muted : null, liveTracks: tracks.filter((t) => t.readyState === 'live').length };
      });

      // The sink has the live mic attached, but is MUTED by default (box off).
      await expect
        .poll(async () => (await monitorState()).liveTracks, { timeout: 20000, message: 'monitor sink never got a live mic track' })
        .toBeGreaterThan(0);
      expect((await monitorState()).muted).toBe(true);

      // Tick "Hear myself" → the sink un-mutes so the user hears their own mic.
      await dialog.getByTestId('mic-monitor-toggle').click();
      await expect.poll(async () => (await monitorState()).muted, { timeout: 5000 }).toBe(false);

      // Untick → muted again.
      await dialog.getByTestId('mic-monitor-toggle').click();
      await expect.poll(async () => (await monitorState()).muted, { timeout: 5000 }).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
