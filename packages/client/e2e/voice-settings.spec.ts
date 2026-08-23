import { test, expect, type Page } from '@playwright/test';
import { registerUser, loginViaToken } from './helpers';

/**
 * E2E for the Voice & Video settings the user reported missing/broken:
 *  - Push-to-Talk mode must expose an inline keybind recorder you can actually set.
 *  - A Mic Test with a live level meter that moves when the mic picks up sound.
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

async function openVoiceSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByText('Voice & Video', { exact: true }).click();
  // Input Mode section is the anchor for the voice settings.
  await expect(page.getByRole('button', { name: 'Push to Talk', exact: true })).toBeVisible({ timeout: 15000 });
}

test.describe('Voice & Video settings', () => {
  test('Push to Talk mode shows a keybind recorder that can be set', async ({ browser, request }) => {
    test.setTimeout(120000);
    const user = await registerUser(request, 'pttset');
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
    const page = await ctx.newPage();
    try {
      await loginViaToken(page, user.token, { email: user.email, password: 'TestPass123A' });
      await openVoiceSettings(page);

      // Selecting Push to Talk must reveal the inline shortcut recorder.
      await page.getByRole('button', { name: 'Push to Talk', exact: true }).click();
      const recorder = page.getByTestId('ptt-keybind');
      await expect(recorder).toBeVisible();
      await expect(recorder).toHaveText(/click to set a key/i);

      // Record a key and confirm it sticks.
      await recorder.click();
      await expect(recorder).toHaveText(/press a key/i);
      await page.keyboard.press('v');
      await expect(recorder).toHaveText('V', { timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });

  test('Mic Test shows a live level meter that responds to the mic', async ({ browser, request }) => {
    test.setTimeout(120000);
    const user = await registerUser(request, 'mictest');
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
    const page = await ctx.newPage();
    try {
      await loginViaToken(page, user.token, { email: user.email, password: 'TestPass123A' });
      await openVoiceSettings(page);

      await page.getByTestId('mic-test-toggle').click();
      const level = page.getByTestId('mic-test-level');
      await expect(level).toBeVisible();
      // The Chromium fake mic emits a pulsing tone, so the meter must read > 0.
      await expect
        .poll(
          () => level.evaluate((el) => Number((el as HTMLElement).dataset.level ?? '0')),
          { timeout: 15000, message: 'Mic test level meter never moved' },
        )
        .toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});
