import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild,
  clearRateLimits,
  loginViaToken,
  clickFirstGuild,
  sendMessageViaAPI,
  type GuildFixture,
} from './helpers';

/**
 * Search E2E Tests
 *
 * Verifies that the search bar accepts text input, shows filter suggestions,
 * and displays search results.
 */

const PASSWORD = 'TestPass123A';

test.describe('Search', () => {
  let fixture: GuildFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'search');

    // Seed a few messages so search has something to find
    await sendMessageViaAPI(request, fixture.token, fixture.channelId, 'hello world');
    await sendMessageViaAPI(request, fixture.token, fixture.channelId, 'search test unique_token_xyz');
    await sendMessageViaAPI(request, fixture.token, fixture.channelId, 'another message');
  });

  test('search input accepts text and submits on Enter', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    // Wait for the channel list to load
    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });

    // Click general channel to get into the chat area
    await page.locator('[role="button"][aria-label*="general" i]').first().click();

    // The search button/icon should be in the chat header toolbar
    // Click the search icon to open the search bar
    const searchToggle = page.getByLabel('Channel header').locator('[aria-label="Search"]');
    await expect(searchToggle).toBeVisible({ timeout: 10000 });
    await searchToggle.click();

    // The search input should appear
    const searchInput = page.locator('input[aria-label="Search messages"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Type a search query and press Enter
    await searchInput.fill('hello');
    await searchInput.press('Enter');

    // Wait for the search results panel to appear
    const resultsPanel = page.locator('[aria-label="Search results"]');
    await expect(resultsPanel).toBeVisible({ timeout: 15000 });

    // Wait for either search results or "No results" message to appear
    // Use a single combined locator to avoid race conditions between the two checks
    await expect(
      resultsPanel.locator('text=/result/i').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('search shows filter suggestions when focused with empty input', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });
    await page.locator('[role="button"][aria-label*="general" i]').first().click();

    // Open search
    const searchToggle = page.getByLabel('Channel header').locator('[aria-label="Search"]');
    await expect(searchToggle).toBeVisible({ timeout: 10000 });
    await searchToggle.click();

    const searchInput = page.locator('input[aria-label="Search messages"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Focus the empty input -- filter suggestions should appear
    await searchInput.focus();

    // Verify filter suggestions dropdown is visible
    const suggestions = page.locator('[aria-label="Search filters"]');
    await expect(suggestions).toBeVisible({ timeout: 5000 });

    // Verify all filter types are listed
    await expect(suggestions.locator('text=from:')).toBeVisible();
    await expect(suggestions.locator('text=in:')).toBeVisible();
    await expect(suggestions.locator('text=has:')).toBeVisible();
    await expect(suggestions.locator('text=before:')).toBeVisible();
    await expect(suggestions.locator('text=after:')).toBeVisible();
  });

  test('close button dismisses search panel', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    await expect(
      page.locator('[role="button"][aria-label*="general" i]').first(),
    ).toBeVisible({ timeout: 10000 });
    await page.locator('[role="button"][aria-label*="general" i]').first().click();

    // Open search
    const searchToggle = page.getByLabel('Channel header').locator('[aria-label="Search"]');
    await expect(searchToggle).toBeVisible({ timeout: 10000 });
    await searchToggle.click();

    const searchInput = page.locator('input[aria-label="Search messages"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Close via the close button
    const closeBtn = page.locator('[aria-label="Close search"]');
    await expect(closeBtn).toBeVisible({ timeout: 3000 });
    await closeBtn.click();

    // Search input should disappear
    await expect(searchInput).not.toBeVisible({ timeout: 5000 });
  });
});
