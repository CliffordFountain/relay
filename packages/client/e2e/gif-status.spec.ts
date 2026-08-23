import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild,
  clearRateLimits,
  enterGeneralChannel,
  type GuildFixture,
} from './helpers';

/**
 * GIF Picker + Online Status E2E Tests
 *
 * GIF tests:
 *   - GIF picker opens and loads trending GIFs from GIPHY
 *   - Selecting a GIF sends it and renders as an inline image (not raw URL text)
 *   - GIF badge ("GIF") is shown in the bottom-left of the image
 *
 * Status tests:
 *   - User panel shows green dot and "Online" on login
 *   - Member list shows the user in the "ONLINE" section on login
 *   - Changing to Idle turns the user panel dot yellow and moves member list dot to yellow
 *   - Changing to DND turns the user panel dot red
 *   - Changing to Invisible moves the user to the OFFLINE section
 *   - Changing back to Online moves the user back to ONLINE section
 */

const PASSWORD = 'TestPass123A';

// ─────────────────────────────────────────────────────────────────────────────
// GIF Picker
// ─────────────────────────────────────────────────────────────────────────────

test.describe('GIF Picker', () => {
  let fixture: GuildFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'gif');
  });

  test('GIF picker opens and displays trending GIFs from GIPHY', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    // Click the GIF button in the message toolbar
    const gifBtn = page.getByRole('button', { name: 'Open GIF picker' });
    await expect(gifBtn).toBeVisible({ timeout: 10_000 });
    await gifBtn.click();

    // The GIF picker dialog should appear
    const picker = page.getByRole('dialog', { name: 'GIF picker' });
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // GIF search is an external GIPHY integration; skip gracefully if no key is configured.
    const noGiphyKey = await picker.getByText(/GIPHY API key/i).isVisible().catch(() => false);
    test.skip(noGiphyKey, 'No GIPHY API key configured (set VITE_GIPHY_API_KEY)');

    // Should NOT show the error state
    await expect(picker.getByText('Failed to load GIFs')).not.toBeVisible();

    // GIF items must load (up to 20 from GIPHY trending)
    const gifItems = picker.locator('[role="option"]');
    await expect(gifItems.first()).toBeVisible({ timeout: 15_000 });
    expect(await gifItems.count()).toBeGreaterThan(0);

    // GIPHY branding must be present
    await expect(picker.getByText('Powered by GIPHY')).toBeVisible();
  });

  test('GIF picker has a working search box', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    const gifBtn = page.getByRole('button', { name: 'Open GIF picker' });
    await gifBtn.click();

    const picker = page.getByRole('dialog', { name: 'GIF picker' });
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // GIF search is an external GIPHY integration; skip gracefully if no key is configured.
    const noGiphyKey = await picker.getByText(/GIPHY API key/i).isVisible().catch(() => false);
    test.skip(noGiphyKey, 'No GIPHY API key configured (set VITE_GIPHY_API_KEY)');

    // Type in the search box
    const searchInput = picker.getByRole('textbox', { name: 'Search GIFs' });
    await searchInput.fill('cat');

    // Results should reload (skeleton then images)
    const gifItems = picker.locator('[role="option"]');
    await expect(gifItems.first()).toBeVisible({ timeout: 15_000 });
    expect(await gifItems.count()).toBeGreaterThan(0);
  });

  test('selecting a GIF sends it and renders as inline image (not raw URL text)', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    const gifBtn = page.getByRole('button', { name: 'Open GIF picker' });
    await gifBtn.click();

    const picker = page.getByRole('dialog', { name: 'GIF picker' });
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // GIF search is an external GIPHY integration; skip gracefully if no key is configured.
    const noGiphyKey = await picker.getByText(/GIPHY API key/i).isVisible().catch(() => false);
    test.skip(noGiphyKey, 'No GIPHY API key configured (set VITE_GIPHY_API_KEY)');

    // Wait for GIFs to load and click the first one
    const firstGif = picker.locator('[role="option"]').first();
    await expect(firstGif).toBeVisible({ timeout: 15_000 });

    // Get the src URL of the thumbnail so we can verify the full URL was sent
    const thumbSrc = await firstGif.locator('img').getAttribute('src');
    expect(thumbSrc).toBeTruthy();

    await firstGif.click();

    // Picker should close after selection
    await expect(picker).not.toBeVisible({ timeout: 5_000 });

    // The message should appear in the chat
    const messageList = page.locator('[aria-label="Messages in general"]');
    await expect(messageList).toBeVisible({ timeout: 10_000 });

    // The GIF must render as an inline <img>, NOT as a plain URL string
    const gifEmbed = messageList.locator('[class*="gifEmbed"] img, [class*="gifImage"]').last();
    await expect(gifEmbed).toBeVisible({ timeout: 15_000 });

    // The GIF badge must be visible (CSS ::after pseudo-element via gifEmbed class)
    const gifEmbedWrapper = messageList.locator('[class*="gifEmbed"]').last();
    await expect(gifEmbedWrapper).toBeVisible({ timeout: 5_000 });

    // The raw GIF URL must NOT appear as plain text in the chat
    // (raw URL text would look like https://media*.giphy.com/... as a text node)
    const rawUrlText = messageList.locator('text=/https:\\/\\/media\\d*\\.giphy\\.com\\//');
    await expect(rawUrlText).not.toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Online Status
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Online Status', () => {
  let fixture: GuildFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'status');
  });

  test('user panel shows Online with green dot on login', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    const userPanel = page.getByRole('region', { name: 'User status and settings' });
    await expect(userPanel).toBeVisible({ timeout: 10_000 });

    // Status text should say "Online"
    await expect(userPanel.getByText('Online')).toBeVisible({ timeout: 5_000 });

    // Status dot must have the "online" class
    const dot = userPanel.locator('[class*="statusDot_online"]');
    await expect(dot).toBeVisible({ timeout: 5_000 });
  });

  test('member list shows current user in ONLINE section on login', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    const memberList = page.getByRole('complementary', { name: 'Member list' });
    await expect(memberList).toBeVisible({ timeout: 10_000 });

    // The ONLINE heading must be present with count ≥ 1
    const onlineHeading = memberList.locator('h3, [role="heading"]').filter({ hasText: /online/i }).first();
    await expect(onlineHeading).toBeVisible({ timeout: 10_000 });

    // The member's status dot has aria-label="online" (set in MemberList.tsx)
    const memberDot = memberList.locator('[aria-label="online"]').first();
    await expect(memberDot).toBeVisible({ timeout: 10_000 });

    // Verify the dot's inline style is the online-status green (#28aa5e)
    const bgColor = await memberDot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    expect(bgColor).toBe('rgb(40, 170, 94)');
  });

  test('changing status to Idle updates user panel dot to yellow and member list', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    // Open status selector
    const statusBtn = page.getByRole('button', { name: 'Manage profile and status' });
    await statusBtn.click();

    // Click Idle
    const idleOption = page.getByRole('menuitem').filter({ hasText: 'Idle' });
    await expect(idleOption).toBeVisible({ timeout: 5_000 });
    await idleOption.click();

    // User panel should now show "Idle" and have idle dot class
    const userPanel = page.getByRole('region', { name: 'User status and settings' });
    await expect(userPanel.getByText('Idle')).toBeVisible({ timeout: 5_000 });
    await expect(userPanel.locator('[class*="statusDot_idle"]')).toBeVisible({ timeout: 5_000 });

    // Member list dot must turn idle yellow (#f5b737)
    const memberList = page.getByRole('complementary', { name: 'Member list' });
    const memberDot = memberList.locator('[aria-label="idle"]').first();
    await expect(memberDot).toBeVisible({ timeout: 10_000 });
    const bgColor = await memberDot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    expect(bgColor).toBe('rgb(245, 183, 55)');
  });

  test('changing status to Do Not Disturb updates user panel dot to red', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    const statusBtn = page.getByRole('button', { name: 'Manage profile and status' });
    await statusBtn.click();

    const dndOption = page.getByRole('menuitem').filter({ hasText: 'Do Not Disturb' });
    await expect(dndOption).toBeVisible({ timeout: 5_000 });
    await dndOption.click();

    const userPanel = page.getByRole('region', { name: 'User status and settings' });
    await expect(userPanel.getByText('Do Not Disturb')).toBeVisible({ timeout: 5_000 });
    await expect(userPanel.locator('[class*="statusDot_dnd"]')).toBeVisible({ timeout: 5_000 });

    // Member list dot must turn DND red (#f74448)
    const memberList = page.getByRole('complementary', { name: 'Member list' });
    const memberDot = memberList.locator('[aria-label="dnd"]').first();
    await expect(memberDot).toBeVisible({ timeout: 10_000 });
    const bgColor = await memberDot.evaluate((el: HTMLElement) => el.style.backgroundColor);
    expect(bgColor).toBe('rgb(247, 68, 72)');
  });

  test('changing status to Invisible moves user to OFFLINE section', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    const statusBtn = page.getByRole('button', { name: 'Manage profile and status' });
    await statusBtn.click();

    const invOption = page.getByRole('menuitem').filter({ hasText: 'Invisible' });
    await expect(invOption).toBeVisible({ timeout: 5_000 });
    await invOption.click();

    // User panel shows "Invisible"
    const userPanel = page.getByRole('region', { name: 'User status and settings' });
    await expect(userPanel.getByText('Invisible')).toBeVisible({ timeout: 5_000 });

    // Member list must now show an OFFLINE section (user appears offline to others)
    const memberList = page.getByRole('complementary', { name: 'Member list' });
    const offlineHeading = memberList.locator('h3, [role="heading"]').filter({ hasText: /offline/i }).first();
    await expect(offlineHeading).toBeVisible({ timeout: 5_000 });
  });

  test('changing status back to Online moves user to ONLINE section', async ({ page }) => {
    await enterGeneralChannel(page, fixture.token, { email: fixture.email, password: PASSWORD });

    // First go invisible
    const statusBtn = page.getByRole('button', { name: 'Manage profile and status' });
    await statusBtn.click();
    await page.getByRole('menuitem').filter({ hasText: 'Invisible' }).click();

    const userPanel = page.getByRole('region', { name: 'User status and settings' });
    await expect(userPanel.getByText('Invisible')).toBeVisible({ timeout: 5_000 });

    // Now go back to Online
    await statusBtn.click();
    const onlineOption = page.getByRole('menuitem').filter({ hasText: /^Online$/ });
    await expect(onlineOption).toBeVisible({ timeout: 5_000 });
    await onlineOption.click();

    // User panel should now show Online
    await expect(userPanel.getByText('Online')).toBeVisible({ timeout: 5_000 });
    await expect(userPanel.locator('[class*="statusDot_online"]')).toBeVisible({ timeout: 5_000 });

    // Member list should show ONLINE section again (not just OFFLINE)
    const memberList = page.getByRole('complementary', { name: 'Member list' });
    const onlineHeading = memberList.locator('h3, [role="heading"]').filter({ hasText: /online/i }).first();
    await expect(onlineHeading).toBeVisible({ timeout: 5_000 });
  });
});
