import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild, addMemberToGuild, sendMessageViaAPI,
  enterGeneralChannel, loginViaToken, clickFirstGuild,
} from './helpers';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

test('leaving a server persists across a refresh', async ({ browser, request }) => {
  test.setTimeout(150000);
  // Bug: Leave Server only mutated local state, so the guild came back on refresh.
  const owner = await registerUserWithGuild(request, 'lvown');
  const bob = await addMemberToGuild(request, owner.token, owner.guildId, 'lvbob');

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await loginViaToken(page, bob.token, { email: bob.email, password: 'TestPass123A' });
    await clickFirstGuild(page);

    const guildItem = page.locator(`nav[aria-label="Servers"] [role="treeitem"][aria-label="${owner.guildName}"]`);
    await expect(guildItem).toBeVisible({ timeout: 15000 });

    // Open the server header dropdown and click Leave Server.
    await page.locator('[aria-label$="server options"]').first().click();
    const leaveItem = page.getByText('Leave Server', { exact: true });
    await expect(leaveItem).toBeVisible({ timeout: 8000 });
    await leaveItem.click();

    // Gone immediately...
    await expect(guildItem).toHaveCount(0, { timeout: 10000 });
    // ...and still gone after a full reload (proves it was persisted server-side).
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await expect(guildItem).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('the current user shows as ONLINE in the member list (not offline)', async ({ browser, request }) => {
  test.setTimeout(150000);
  // Bug: self had no presence entry, so the member list defaulted them to Offline while
  // the user panel showed Online.
  const owner = await registerUserWithGuild(request, 'prsown');
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });
    // The member list lists this user; for a fresh single-member guild an online user
    // produces NO "Offline" group at all. If the bug were present, the sole member would
    // sit under an "Offline" header.
    await expect(page.getByText(owner.username).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/offline/i)).toHaveCount(0, { timeout: 10000 });
  } finally {
    await ctx.close();
  }
});

test('the reaction picker opens under the message, not off to the side', async ({ browser, request }) => {
  test.setTimeout(150000);
  const owner = await registerUserWithGuild(request, 'rxown');
  await sendMessageViaAPI(request, owner.token, owner.channelId, 'react to me please');

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });
    const msg = page.getByText('react to me please').first();
    await expect(msg).toBeVisible({ timeout: 20000 });
    await msg.hover();

    const addBtn = page.locator('[aria-label="Add Reaction"]').first();
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    const btnBox = await addBtn.boundingBox();
    await addBtn.click();

    const picker = page.getByTestId('reaction-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });
    const pickBox = await picker.boundingBox();
    expect(pickBox).not.toBeNull();
    expect(btnBox).not.toBeNull();

    // Opens DOWNWARD from the button (bug made it fly up/right), and stays on-screen.
    expect(pickBox!.y).toBeGreaterThan(btnBox!.y - 12);
    const vw = page.viewportSize()!.width;
    expect(pickBox!.x).toBeGreaterThanOrEqual(-2);
    expect(pickBox!.x + pickBox!.width).toBeLessThanOrEqual(vw + 4);
  } finally {
    await ctx.close();
  }
});
