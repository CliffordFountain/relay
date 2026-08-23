import { test, expect } from '@playwright/test';
import { registerUserWithGuild, sendMessageViaAPI, enterGeneralChannel } from './helpers';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

test('the message "More" menu opens anchored to the button, not far-left', async ({ browser, request }) => {
  test.setTimeout(150000);
  // Bug: the reposition effect subtracted the menu width from `left` on every render
  // (it depended on menuPosition while setting it), so the menu slid to left:8 (far left)
  // regardless of the button position. It must anchor under the "More" button.
  const owner = await registerUserWithGuild(request, 'menu');
  await sendMessageViaAPI(request, owner.token, owner.channelId, 'menu position test');

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });

    const msg = page.getByText('menu position test').first();
    await expect(msg).toBeVisible({ timeout: 20000 });
    await msg.hover();

    const moreBtn = page.locator('[aria-label="More"]').first();
    await expect(moreBtn).toBeVisible({ timeout: 10000 });
    const btnBox = await moreBtn.boundingBox();
    expect(btnBox).not.toBeNull();

    await moreBtn.click();
    const menu = page.getByRole('menu', { name: 'Message actions menu' });
    await expect(menu).toBeVisible({ timeout: 5000 });
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();

    // The menu's right edge should sit under the button's right edge (right-aligned to it)...
    const menuRight = menuBox!.x + menuBox!.width;
    const btnRight = btnBox!.x + btnBox!.width;
    expect(Math.abs(menuRight - btnRight)).toBeLessThan(48);
    // ...and it must NOT be slammed against the far-left edge of the viewport.
    expect(menuBox!.x).toBeGreaterThan(80);
  } finally {
    await ctx.close();
  }
});
