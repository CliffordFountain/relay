import { test, expect } from '@playwright/test';
import {
  uniqueId,
  registerUser,
  registerUserWithGuild,
  clearRateLimits,
  loginViaToken,
  clickFirstGuild,
  createGuildViaUI,
  openServerDropdown,
  apiWithRetry,
  API_BASE,
  type GuildFixture,
} from './helpers';

/**
 * Guild / Server Management E2E Tests
 *
 * Covers creating servers, default channels, channel CRUD,
 * server settings, and header dropdown.
 */

const PASSWORD = 'TestPass123A';

test.describe('Guild / Server Management', () => {
  let fixture: GuildFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'guild');
  });

  // Test 1: Create server -> appears in sidebar AND channel list shows #general
  test('create server via UI -> server icon in sidebar and #general in channel list', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    const serverName = `NewSrv_${uniqueId()}`;

    await createGuildViaUI(page, serverName);

    // Guild icon must be visible in the sidebar
    await expect(
      page.locator(`nav[aria-label="Servers"] [role="treeitem"][aria-label="${serverName}"]`),
    ).toBeVisible({ timeout: 10000 });

    // Click the new guild to see its channels
    await page.locator(`[role="treeitem"][aria-label="${serverName}"]`).click();

    // #general text channel must appear in the channel list
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  // Test 2: Default channels exist - both text and voice categories/channels
  test('new guild has default #general text channel and voice channel', async ({ page, request }) => {
    const user = await registerUser(request, 'gdef');
    await loginViaToken(page, user.token, { email: user.email, password: PASSWORD });

    const serverName = `Defaults_${uniqueId()}`;
    await createGuildViaUI(page, serverName);

    // Click the guild to see channels
    await page.locator(`[role="treeitem"][aria-label="${serverName}"]`).click();

    // #general text channel must exist
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });

    // TEXT CHANNELS category header must exist
    await expect(page.getByText(/text channels/i)).toBeVisible({ timeout: 10000 });

    // VOICE CHANNELS category header must exist
    await expect(page.getByText(/voice channels/i)).toBeVisible({ timeout: 10000 });
  });

  // Test 3: Click channel -> chat area loads with header and message input
  test('click #general channel -> chat header and message input visible', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    // Click general channel
    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });
    await generalChannel.click();

    // Message input textarea must appear
    await expect(
      page.locator('textarea[aria-label*="Message"]'),
    ).toBeVisible({ timeout: 10000 });

    // Chat header must show channel name "general"
    await expect(
      page.getByLabel('Channel header').locator('[class*="channelName"]').filter({ hasText: 'general' }),
    ).toBeVisible({ timeout: 10000 });
  });

  // Test 4: Create new text channel -> appears in channel list
  test('create text channel -> new channel appears in list', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });

    // Open server header dropdown
    await openServerDropdown(page);

    // Click "Create Channel" option - must be present
    const createOption = page.locator('[role="menuitem"]').filter({ hasText: /create channel/i });
    await expect(createOption).toBeVisible({ timeout: 5000 });
    await createOption.click();

    // Create channel dialog must appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill channel name and submit
    const channelName = `test-ch-${uniqueId().slice(0, 6)}`;
    await page.locator('#channel-name').fill(channelName);
    await page.locator('[role="dialog"] button[type="submit"]').click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // New channel must appear in the channel list
    await expect(
      page.locator(`[role="button"][aria-label*="${channelName}" i]`),
    ).toBeVisible({ timeout: 10000 });
  });

  // Test 5: Create voice channel -> appears with voice icon
  test('create voice channel -> new voice channel appears in list', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });

    // Open server header dropdown
    await openServerDropdown(page);

    // Click "Create Channel"
    const createOption = page.locator('[role="menuitem"]').filter({ hasText: /create channel/i });
    await expect(createOption).toBeVisible({ timeout: 5000 });
    await createOption.click();

    // Create channel dialog must appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Select voice channel type - look for a radio/button labeled "Voice"
    const voiceTypeOption = dialog.getByText(/^voice$/i);
    await expect(voiceTypeOption).toBeVisible({ timeout: 5000 });
    await voiceTypeOption.click();

    // Fill channel name and submit
    const channelName = `vc-${uniqueId().slice(0, 6)}`;
    await page.locator('#channel-name').fill(channelName);
    await page.locator('[role="dialog"] button[type="submit"]').click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // New voice channel must appear - aria-label should contain "Voice channel"
    await expect(
      page.locator(`[role="button"][aria-label*="${channelName}" i]`),
    ).toBeVisible({ timeout: 10000 });
  });

  // Test 6: Edit channel name via settings
  test('edit channel name via channel settings -> name changes', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });

    // Right-click to open context menu
    await generalChannel.click({ button: 'right' });

    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // Click "Edit Channel" - must exist
    const editOption = contextMenu.locator('[role="menuitem"]').filter({ hasText: /edit channel/i });
    await expect(editOption).toBeVisible({ timeout: 5000 });
    await editOption.click();

    // Channel settings must open with name input
    const nameInput = page.locator('#channel-name');
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    // Verify Overview heading is visible (confirms settings opened)
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 5000 });

    // Change the name
    const newName = `renamed-${uniqueId().slice(0, 5)}`;
    await nameInput.fill(newName);

    // Save bar should appear with unsaved changes notice
    await expect(page.getByText(/unsaved changes/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /save changes/i }).click();

    // Save bar should disappear after saving
    await expect(page.getByText(/unsaved changes/i)).not.toBeVisible({ timeout: 10000 });
  });

  // Test 7: Delete channel -> removed from list
  test('delete channel via context menu -> channel removed from list', async ({ page, request }) => {
    // Create a channel to delete via API
    const channelName = `todel-${uniqueId().slice(0, 5)}`;
    const createRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${fixture.guildId}/channels`, {
      data: { name: channelName, type: 0 },
      headers: { Authorization: `Bearer ${fixture.token}` },
    });

    // Channel creation must succeed - no silent bail-out
    expect(createRes.ok).toBe(true);

    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    // The channel we just created must be visible
    const channel = page.locator(`[role="button"][aria-label*="${channelName}" i]`);
    await expect(channel).toBeVisible({ timeout: 10000 });

    // Right-click channel to open context menu
    await channel.click({ button: 'right' });
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // Click "Delete Channel" - must exist
    const deleteOption = contextMenu.locator('[role="menuitem"]').filter({ hasText: /delete channel/i });
    await expect(deleteOption).toBeVisible({ timeout: 5000 });
    await deleteOption.click();

    // Wait for either: confirmation dialog appears OR channel is directly removed
    const confirmDialog = page.locator('[role="dialog"]').filter({ hasText: /delete/i });
    const dialogVisible = await confirmDialog.isVisible({ timeout: 3000 }).catch(() => false);
    if (dialogVisible) {
      await confirmDialog.getByRole('button', { name: /delete/i }).click();
    }

    // Channel must be removed from the list
    await expect(channel).not.toBeVisible({ timeout: 10000 });
  });

  // Test 8: Server settings opens with Overview, Roles, Members tabs
  test('server settings opens from dropdown with Overview, Roles, Members tabs', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });

    // Open server dropdown
    await openServerDropdown(page);

    // Click Server Settings
    const settingsOption = page.locator('[role="menuitem"]').filter({ hasText: /server settings/i });
    await expect(settingsOption).toBeVisible({ timeout: 5000 });
    await settingsOption.click();

    // Server settings must open - verify all three nav tabs
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Roles' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Members' })).toBeVisible({ timeout: 10000 });

    // Close settings
    await page.keyboard.press('Escape');
  });

  // Test 9: Server header dropdown shows all expected options
  test('server header dropdown shows key menu items for guild owner', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });

    // Click server name/header to open dropdown
    await openServerDropdown(page);

    const dropdown = page.locator('[role="menu"]');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Core menu items that must be present for a guild owner
    await expect(
      dropdown.locator('[role="menuitem"]').filter({ hasText: /invite to server/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      dropdown.locator('[role="menuitem"]').filter({ hasText: /server settings/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      dropdown.locator('[role="menuitem"]').filter({ hasText: /create channel/i }),
    ).toBeVisible({ timeout: 5000 });

    // Additional menu items present in the full dropdown
    await expect(
      dropdown.locator('[role="menuitem"]').filter({ hasText: /create category/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      dropdown.locator('[role="menuitem"]').filter({ hasText: /notification settings/i }),
    ).toBeVisible({ timeout: 5000 });

    // Leave Server is hidden for guild owners, so it should NOT be visible
    await expect(
      dropdown.locator('[role="menuitem"]').filter({ hasText: /leave server/i }),
    ).not.toBeVisible();

    await page.keyboard.press('Escape');
  });
});
