import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild,
  clearRateLimits,
  loginViaToken,
  clickFirstGuild,
  openServerDropdown,
  type GuildFixture,
} from './helpers';

/**
 * Settings E2E Tests
 *
 * Covers user settings (My Account, Profiles, Appearance, Voice & Video,
 * Notifications, Keybinds, Log Out) and server settings (Overview, Roles, Members).
 */

const PASSWORD = 'TestPass123A';

test.describe('Settings', () => {
  let fixture: GuildFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'set');
  });

  async function openUserSettings(page: import('@playwright/test').Page) {
    // User Settings button has aria-label="User Settings"
    const settingsButton = page.locator('[aria-label="User Settings"]');
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await settingsButton.click();

    // User settings dialog (role="dialog" aria-label="User Settings")
    const dialog = page.locator('[role="dialog"][aria-label="User Settings"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Wait for the "My Account" nav button to confirm settings loaded
    await expect(page.getByRole('button', { name: 'My Account' })).toBeVisible({ timeout: 5000 });
  }

  // Test 1: User settings opens with all expected nav items
  test('click gear icon -> user settings modal opens with all navigation tabs and Log Out', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });

    await openUserSettings(page);

    // Verify all nav items are visible
    await expect(page.getByRole('button', { name: 'My Account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Content & Social' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voice & Video' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keybinds' })).toBeVisible();

    // Log Out button
    const logOut = page.locator('button').filter({ hasText: /^Log Out$/ });
    await expect(logOut).toBeVisible();

    await page.keyboard.press('Escape');
  });

  // Test 2: My Account shows username and Edit buttons
  test('My Account page shows username text and Edit buttons', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await openUserSettings(page);

    // Username should be displayed
    await expect(page.getByText(fixture.username).first()).toBeVisible({ timeout: 5000 });

    // Email should be displayed (possibly masked, but the domain should be visible)
    await expect(page.getByText(/@test\.com/).first()).toBeVisible({ timeout: 5000 });

    // Edit button(s) should be present for editing username/email/display name
    const editButtons = page.locator('button').filter({ hasText: /^Edit$/i });
    const editCount = await editButtons.count();
    expect(editCount).toBeGreaterThanOrEqual(1);

    await page.keyboard.press('Escape');
  });

  // Test 3: Profiles tab shows bio, pronouns, accent color
  test('Profiles tab shows bio textarea, pronouns input, and accent color picker', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await openUserSettings(page);

    // Click Content & Social tab (formerly Profiles)
    await page.getByRole('button', { name: 'Content & Social' }).click();

    // Bio textarea (placeholder: "Tell the world a little about yourself")
    const bioField = page.locator('textarea');
    await expect(bioField.first()).toBeVisible({ timeout: 5000 });

    // Pronouns input (placeholder: "Add your pronouns")
    const pronounsInput = page.locator('input[placeholder="Add your pronouns"]');
    await expect(pronounsInput).toBeVisible({ timeout: 5000 });

    // Banner Color label and color input
    await expect(page.getByText('BANNER COLOR')).toBeVisible({ timeout: 5000 });
    const colorInput = page.locator('input[type="color"]');
    await expect(colorInput.first()).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
  });

  // Test 4: Appearance tab has Dark/Light theme toggle
  test('Appearance tab shows the Relay theme', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await openUserSettings(page);
    await page.getByRole('button', { name: 'Appearance' }).click();
    const relayOption = page.locator('button').filter({ hasText: /^Relay$/ });
    await expect(relayOption).toBeVisible({ timeout: 5000 });
    const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(themeAttr).toBe('relay');
    await page.keyboard.press('Escape');
  });

  // Test 5: Voice & Video shows Input Device and Output Device labels
  test('Voice & Video tab shows Input Device and Output Device labels', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await openUserSettings(page);

    // Click Voice & Video tab
    await page.getByRole('button', { name: 'Voice & Video' }).click();

    // Input device label
    await expect(page.getByText('INPUT DEVICE')).toBeVisible({ timeout: 5000 });

    // Output device label
    await expect(page.getByText('OUTPUT DEVICE')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
  });

  // Server settings - Overview, Roles with @everyone, Members with owner
  test('server settings shows Overview, Roles with @everyone, and Members with owner', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);
    await expect(page.locator('[role="button"][aria-label*="general" i]').first()).toBeVisible({ timeout: 10000 });

    // Open server settings via dropdown
    await openServerDropdown(page);
    await page.locator('[role="menuitem"]').filter({ hasText: /server settings/i }).click();

    // Wait for Overview nav button to confirm server settings loaded
    const overviewBtn = page.getByRole('button', { name: 'Overview' });
    await expect(overviewBtn).toBeVisible({ timeout: 10000 });

    // Navigate to Roles tab
    const rolesNav = page.getByRole('button', { name: 'Roles' });
    await expect(rolesNav).toBeVisible({ timeout: 5000 });
    await rolesNav.click();

    // @everyone role should be visible in roles list
    await expect(page.getByText('@everyone').first()).toBeVisible({ timeout: 5000 });

    // Navigate to Members tab
    const membersNav = page.getByRole('button', { name: 'Members' });
    await expect(membersNav).toBeVisible({ timeout: 5000 });
    await membersNav.click();

    // Owner's username should be visible in the members list
    await expect(page.getByText(fixture.username).first()).toBeVisible({ timeout: 10000 });

    // Close settings
    await page.keyboard.press('Escape');
  });
});
