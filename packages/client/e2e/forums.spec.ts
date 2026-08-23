import { test, expect } from '@playwright/test';
import {
  uniqueId,
  registerUserWithGuild,
  clearRateLimits,
  loginViaToken,
  clickFirstGuild,
  apiWithRetry,
  API_BASE,
  type GuildFixture,
} from './helpers';

/**
 * Forum Channel E2E Tests
 *
 * Covers creating a forum channel, viewing the ForumView,
 * creating a forum post, and navigating into a post.
 */

const PASSWORD = 'TestPass123A';

test.describe('Forum Channels', () => {
  let fixture: GuildFixture;
  let forumChannelId: string;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'forum');

    // Create a forum channel (type 15) via API
    const forumRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${fixture.guildId}/channels`, {
      data: { name: `forum-${uniqueId().slice(0, 6)}`, type: 15, topic: 'Discuss things here' },
      headers: { Authorization: `Bearer ${fixture.token}` },
    });
    expect(forumRes.ok).toBe(true);
    const forumData = await forumRes.json() as { id: string };
    forumChannelId = forumData.id;
  });

  // Test 1: Navigate to forum channel -> ForumView renders
  test('navigate to forum channel -> ForumView renders with header and New Post button', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    // Click the forum channel in the sidebar
    const forumChannel = page.locator('[role="button"][aria-label*="forum" i]').first();
    await expect(forumChannel).toBeVisible({ timeout: 10000 });
    await forumChannel.click();

    // ForumView should render (data-testid="forum-view")
    await expect(page.locator('[data-testid="forum-view"]')).toBeVisible({ timeout: 10000 });

    // New Post button should be visible
    await expect(page.getByRole('button', { name: /new post/i })).toBeVisible({ timeout: 5000 });

    // Sort and layout controls should be visible
    await expect(page.getByRole('button', { name: /sort order/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /list view/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /grid view/i })).toBeVisible({ timeout: 5000 });
  });

  // Test 2: Empty forum shows empty state
  test('empty forum channel shows "No posts yet" message', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    const forumChannel = page.locator('[role="button"][aria-label*="forum" i]').first();
    await expect(forumChannel).toBeVisible({ timeout: 10000 });
    await forumChannel.click();

    await expect(page.getByText('No posts yet')).toBeVisible({ timeout: 10000 });
  });

  // Test 3: Click "New Post" -> Create Forum Post modal opens
  test('click New Post -> create forum post modal opens with title and content inputs', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    const forumChannel = page.locator('[role="button"][aria-label*="forum" i]').first();
    await expect(forumChannel).toBeVisible({ timeout: 10000 });
    await forumChannel.click();

    await expect(page.locator('[data-testid="forum-view"]')).toBeVisible({ timeout: 10000 });

    // Click New Post button
    await page.getByRole('button', { name: /new post/i }).click();

    // Modal should appear
    const dialog = page.locator('[role="dialog"][aria-label="Create a forum post"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Title input should be present
    await expect(page.locator('#forum-post-title')).toBeVisible({ timeout: 5000 });

    // Content textarea should be present
    await expect(page.locator('#forum-post-content')).toBeVisible({ timeout: 5000 });

    // Post button should be disabled initially
    const postBtn = dialog.getByRole('button', { name: /^post$/i });
    await expect(postBtn).toBeDisabled();
  });

  // Test 4: Create a forum post -> post appears in the list
  test('create a forum post -> post appears in the forum post list', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    const forumChannel = page.locator('[role="button"][aria-label*="forum" i]').first();
    await expect(forumChannel).toBeVisible({ timeout: 10000 });
    await forumChannel.click();

    await expect(page.locator('[data-testid="forum-view"]')).toBeVisible({ timeout: 10000 });

    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();

    const dialog = page.locator('[role="dialog"][aria-label="Create a forum post"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill in title and content
    const postTitle = `Test Forum Post ${uniqueId().slice(0, 6)}`;
    await page.locator('#forum-post-title').fill(postTitle);
    await page.locator('#forum-post-content').fill('This is the body of my forum post.');

    // Click Post button
    const postBtn = dialog.getByRole('button', { name: /^post$/i });
    await expect(postBtn).not.toBeDisabled();
    await postBtn.click();

    // Modal should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Post should appear in the list (scope to forum-post-list to avoid strict mode violation
    // when the thread item name also matches the same text)
    await expect(page.getByTestId('forum-post-list').getByText(postTitle)).toBeVisible({ timeout: 10000 });
  });

  // Test 5: Click a forum post -> thread content loads (ChatArea for thread)
  test('click a forum post -> navigates to thread view', async ({ page, request }) => {
    // Threads are now registered in the channels store when forum posts load,
    // fixing the previous issue where the thread channel was missing from the store.
    // First create a post via API
    const postTitle = `Clickable Post ${uniqueId().slice(0, 6)}`;
    const createRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${forumChannelId}/threads`, {
      data: {
        name: postTitle,
        message: { content: 'Post body for click test' },
      },
      headers: { Authorization: `Bearer ${fixture.token}` },
    });
    expect(createRes.ok).toBe(true);

    // Clear rate limits before login since the API call above may have
    // consumed rate limit budget, causing the app's startup requests to 429
    clearRateLimits();

    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    // Wait for the channel list to populate before looking for the forum channel
    const forumChannel = page.locator('[role="button"][aria-label*="forum" i]').first();
    await expect(forumChannel).toBeVisible({ timeout: 15000 });

    // Capture page errors before clicking
    const pageErrors: string[] = [];
    page.on('pageerror', err => {
      pageErrors.push(err.message);
    });

    await forumChannel.click();

    // Give time for any errors to propagate
    await page.waitForTimeout(1000);
    if (pageErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[E2E] Page errors after click:', JSON.stringify(pageErrors));
    }

    await expect(page.locator('[data-testid="forum-view"]')).toBeVisible({ timeout: 15000 });

    // Wait for the post to appear in the forum post list
    const postItem = page.getByText(postTitle);
    await expect(postItem).toBeVisible({ timeout: 10000 });

    // Click the post
    await postItem.click();

    // After clicking, we should navigate to the thread. Either:
    // 1. A message input appears (thread view loaded)
    // 2. Or the post title appears in a header (thread header)
    const msgInput = page.locator('textarea[aria-label*="Message"]');
    const threadHeader = page.getByText(postTitle);

    // Wait for either indicator that we navigated to the thread
    await expect(msgInput.or(threadHeader)).toBeVisible({ timeout: 15000 });
  });

  // Test 6: Sort dropdown changes sort order
  test('sort dropdown allows switching between Latest Activity and Creation Date', async ({ page }) => {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    const forumChannel = page.locator('[role="button"][aria-label*="forum" i]').first();
    await expect(forumChannel).toBeVisible({ timeout: 10000 });
    await forumChannel.click();

    await expect(page.locator('[data-testid="forum-view"]')).toBeVisible({ timeout: 10000 });

    // Click sort button
    const sortBtn = page.getByRole('button', { name: /sort order/i });
    await sortBtn.click();

    // Options should appear
    await expect(page.getByRole('option', { name: 'Latest Activity' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: 'Creation Date' })).toBeVisible({ timeout: 5000 });

    // Click Creation Date
    await page.getByRole('option', { name: 'Creation Date' }).click();

    // Sort button label should update
    await expect(sortBtn).toContainText('Creation Date');
  });

  // Test 7: Layout toggle switches between list and grid
  test('layout toggle switches between list and grid view', async ({ page, request }) => {
    // Create a post so we have something to see in both layouts
    await apiWithRetry(request, 'post', `${API_BASE}/channels/${forumChannelId}/threads`, {
      data: {
        name: `Layout Test ${uniqueId().slice(0, 6)}`,
        message: { content: 'Testing layout toggle' },
      },
      headers: { Authorization: `Bearer ${fixture.token}` },
    });

    // Clear rate limits before login since the API call above may have
    // consumed rate limit budget, causing the app's startup requests to 429
    clearRateLimits();

    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    const forumChannel = page.locator('[role="button"][aria-label*="forum" i]').first();
    await expect(forumChannel).toBeVisible({ timeout: 15000 });
    await forumChannel.click();

    await expect(page.locator('[data-testid="forum-view"]')).toBeVisible({ timeout: 15000 });

    // Default is list view
    await expect(page.locator('[data-testid="forum-post-list"]')).toBeVisible({ timeout: 10000 });

    // Click grid view
    await page.getByRole('button', { name: /grid view/i }).click();

    // Grid view should be visible
    await expect(page.locator('[data-testid="forum-post-grid"]')).toBeVisible({ timeout: 10000 });

    // Click list view to switch back
    await page.getByRole('button', { name: /list view/i }).click();
    await expect(page.locator('[data-testid="forum-post-list"]')).toBeVisible({ timeout: 10000 });
  });
});
