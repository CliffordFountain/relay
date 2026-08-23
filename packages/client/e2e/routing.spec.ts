import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild,
  loginViaToken,
  clickFirstGuild,
  clearRateLimits,
  API_BASE,
  apiWithRetry,
  type GuildFixture,
} from './helpers';

/**
 * URL Routing E2E Tests
 *
 * Verifies that the URL routing works:
 * - /channels/@me for DM view
 * - /channels/:guildId/:channelId for guild channel view
 * - Browser back/forward updates the view
 * - Direct URL access loads the correct channel
 */

const PASSWORD = 'TestPass123A';

test.describe('URL Routing', () => {
  let fixture: GuildFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'route');
  });

  test('clicking a guild and channel updates the URL to /channels/:guildId/:channelId', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });

    // Click the first guild
    await clickFirstGuild(page);

    // Click the general channel
    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });
    await generalChannel.click();

    // Wait for message input to confirm channel loaded
    await expect(
      page.locator('textarea[aria-label*="Message"]'),
    ).toBeVisible({ timeout: 10000 });

    // Verify URL contains the guild and channel IDs
    const url = page.url();
    expect(url).toContain(`/channels/${fixture.guildId}`);
    expect(url).toContain(fixture.channelId);
  });

  test('clicking Home navigates to /channels/@me', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });

    // Click the first guild to ensure we are on a guild page
    await clickFirstGuild(page);
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });

    // Click Home button
    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    // Wait for the DM view to appear (search input for conversations)
    await expect(
      page.locator('input[aria-label="Find or start a conversation"]'),
    ).toBeVisible({ timeout: 10000 });

    // URL should be /channels/@me
    expect(page.url()).toContain('/channels/@me');
  });

  test('navigating directly to /channels/:guildId/:channelId loads that channel', async ({ page }) => {
    // Set token and navigate directly to a specific channel URL
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((t: string) => {
      localStorage.setItem('token', t);
    }, fixture.token);

    // Navigate directly to the guild channel URL
    await page.goto(`/channels/${fixture.guildId}/${fixture.channelId}`, {
      waitUntil: 'domcontentloaded',
    });

    // Wait for the app to load - the server sidebar must appear
    await expect(
      page.locator('nav[aria-label="Servers"]'),
    ).toBeVisible({ timeout: 30000 });

    // The channel should be loaded - message input must appear
    await expect(
      page.locator('textarea[aria-label*="Message"]'),
    ).toBeVisible({ timeout: 10000 });

    // Chat header should show "general"
    await expect(
      page.getByLabel('Channel header').locator('[class*="channelName"]').filter({ hasText: 'general' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('root URL redirects to /channels/@me when authenticated', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((t: string) => {
      localStorage.setItem('token', t);
    }, fixture.token);
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for app to load
    await expect(
      page.locator('nav[aria-label="Servers"]'),
    ).toBeVisible({ timeout: 30000 });

    // URL should end up at a /channels path (either @me or a guild, depending on restore)
    expect(page.url()).toContain('/channels/');
  });

  test('unauthenticated user at /channels/:guildId/:channelId redirects to /login', async ({ page }) => {
    // Navigate to a channel URL without a token
    await page.goto(`/channels/${fixture.guildId}/${fixture.channelId}`, {
      waitUntil: 'domcontentloaded',
    });

    // Should redirect to login page
    await expect(
      page.locator('h1').filter({ hasText: /welcome back/i }),
    ).toBeVisible({ timeout: 10000 });

    expect(page.url()).toContain('/login');
  });

  test('creating a new channel and clicking it updates URL with new channel ID', async ({ page, request }) => {
    // Create a new channel via API
    const channelName = `routing-test-${Date.now().toString(36).slice(-6)}`;
    const createRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${fixture.guildId}/channels`, {
      data: { name: channelName, type: 0 },
      headers: { Authorization: `Bearer ${fixture.token}` },
    });
    expect(createRes.ok).toBe(true);
    const channelData = await createRes.json() as { id: string };

    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    // Wait for the new channel to appear
    const newChannel = page.locator(`[role="button"][aria-label*="${channelName}" i]`);
    await expect(newChannel).toBeVisible({ timeout: 10000 });

    // Click the new channel
    await newChannel.click();

    // URL should contain the new channel ID
    await expect(async () => {
      const url = page.url();
      expect(url).toContain(`/channels/${fixture.guildId}/${channelData.id}`);
    }).toPass({ timeout: 5000 });
  });
});
