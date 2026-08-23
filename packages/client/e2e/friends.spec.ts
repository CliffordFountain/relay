import { test, expect } from '@playwright/test';
import {
  API_BASE,
  registerUser,
  loginViaToken,
  apiWithRetry,
  getCurrentUserId,
  clearRateLimits,
  type UserFixture,
} from './helpers';

test.describe('Friends System', () => {
  let userA: UserFixture & { userId: string };
  let userB: UserFixture & { userId: string };

  test.beforeAll(async ({ request }) => {
    clearRateLimits();

    // Register two users via API
    const a = await registerUser(request, 'friendA');
    const aId = await getCurrentUserId(request, a.token);
    userA = { ...a, userId: aId };

    const b = await registerUser(request, 'friendB');
    const bId = await getCurrentUserId(request, b.token);
    userB = { ...b, userId: bId };
  });

  test('User A sends friend request to User B via API', async ({ request }) => {
    clearRateLimits();

    const res = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${userB.userId}`, {
      data: { type: 1 },
      headers: { Authorization: `Bearer ${userA.token}` },
    });

    expect(res.status).toBe(204);
  });

  test('User A sees outgoing request in Pending tab', async ({ page }) => {
    await loginViaToken(page, userA.token, { email: userA.email, password: 'TestPass123A' });

    // Click on Home button to go to DM/Friends view
    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    // Wait for Friends page to be visible
    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    // Click Pending tab
    await page.getByRole('tab', { name: /pending/i }).click();

    // Should see user B in the pending list with "Outgoing Friend Request" status
    await expect(page.getByText(userB.username, { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Outgoing Friend Request')).toBeVisible();
  });

  test('User B sees incoming request in Pending tab', async ({ page }) => {
    await loginViaToken(page, userB.token, { email: userB.email, password: 'TestPass123A' });

    // Navigate to home/friends
    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    // Click Pending tab
    await page.getByRole('tab', { name: /pending/i }).click();

    // Should see user A in the pending list with "Incoming Friend Request" status
    await expect(page.getByText(userA.username, { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Incoming Friend Request')).toBeVisible();
  });

  test('User B accepts friend request', async ({ request }) => {
    clearRateLimits();

    const res = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${userA.userId}`, {
      data: { type: 1 },
      headers: { Authorization: `Bearer ${userB.token}` },
    });

    expect(res.status).toBe(204);
  });

  test('User B sees User A in All Friends tab', async ({ page }) => {
    await loginViaToken(page, userB.token, { email: userB.email, password: 'TestPass123A' });

    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    // Click All tab
    await page.getByRole('tab', { name: /^all$/i }).click();

    // Should see user A as a friend
    await expect(page.getByText(userA.username, { exact: false })).toBeVisible({ timeout: 10000 });
  });

  test('User A sees User B in All Friends tab', async ({ page }) => {
    await loginViaToken(page, userA.token, { email: userA.email, password: 'TestPass123A' });

    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    // Click All tab
    await page.getByRole('tab', { name: /^all$/i }).click();

    // Should see user B as a friend
    await expect(page.getByText(userB.username, { exact: false })).toBeVisible({ timeout: 10000 });
  });

  test('User A clicks Message on User B - DM channel opens', async ({ page }) => {
    await loginViaToken(page, userA.token, { email: userA.email, password: 'TestPass123A' });

    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    // Click All tab to see friends
    await page.getByRole('tab', { name: /^all$/i }).click();

    // Wait for the friend to appear
    await expect(page.getByText(userB.username, { exact: false })).toBeVisible({ timeout: 10000 });

    // Click the Message button for User B
    const messageButton = page.getByLabel(`Message ${userB.username}`, { exact: false });
    await messageButton.click();

    // Should navigate to a DM channel - the message input should appear
    await expect(page.locator('textarea[aria-label*="Message"]')).toBeVisible({ timeout: 10000 });
  });

  test('User A sends a message in the DM', async ({ page }) => {
    await loginViaToken(page, userA.token, { email: userA.email, password: 'TestPass123A' });

    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: /^all$/i }).click();

    // Scope to the main content area to avoid matching the DM sidebar entry
    const mainArea = page.getByRole('main', { name: /friends/i });
    await expect(mainArea.getByText(userB.username, { exact: false })).toBeVisible({ timeout: 10000 });

    const messageButton = mainArea.getByLabel(`Message ${userB.username}`, { exact: false });
    await messageButton.click();

    // Wait for DM channel input
    const input = page.locator('textarea[aria-label*="Message"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Send a message
    const testMessage = `Hello from friend test ${Date.now()}`;
    await input.fill(testMessage);
    await input.press('Enter');

    // Verify message appears
    await expect(page.getByText(testMessage)).toBeVisible({ timeout: 10000 });
  });

  test('User A blocks User B - User B appears in Blocked tab', async ({ request, page }) => {
    clearRateLimits();

    // Block via API
    const blockRes = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${userB.userId}`, {
      data: { type: 2 },
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    expect(blockRes.status).toBe(204);

    // Wait for the block relationship to be fully committed server-side
    await new Promise(r => setTimeout(r, 2000));

    // Verify in UI
    await loginViaToken(page, userA.token, { email: userA.email, password: 'TestPass123A' });

    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    const friendsMain = page.getByRole('main', { name: /friends/i });
    await expect(friendsMain).toBeVisible({ timeout: 10000 });

    // Click Blocked tab
    const blockedTab = page.getByRole('tab', { name: /blocked/i });
    await blockedTab.click();

    // Wait for blocked list to load, retry tab click if needed
    // Scope to friendsMain to avoid matching userB's name in the DM sidebar
    try {
      await expect(friendsMain.getByText(userB.username, { exact: false })).toBeVisible({ timeout: 10000 });
    } catch {
      // Retry: re-click the tab to force a refresh
      await blockedTab.click();
      await expect(friendsMain.getByText(userB.username, { exact: false })).toBeVisible({ timeout: 10000 });
    }
  });

  test('User A unblocks User B', async ({ request, page }) => {
    clearRateLimits();

    // Unblock via API (delete relationship)
    const unblockRes = await apiWithRetry(request, 'delete', `${API_BASE}/users/@me/relationships/${userB.userId}`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    expect(unblockRes.status).toBe(204);

    // Verify in UI - blocked list should be empty
    await loginViaToken(page, userA.token, { email: userA.email, password: 'TestPass123A' });

    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    // After unblocking, the Blocked tab should be hidden (no blocked users remain)
    const blockedTab = page.getByRole('tab', { name: /blocked/i });
    await expect(blockedTab).toBeHidden({ timeout: 10000 });
  });

  test('User A re-adds User B as friend and then removes friend', async ({ request, page }) => {
    clearRateLimits();

    // Send friend request again
    await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${userB.userId}`, {
      data: { type: 1 },
      headers: { Authorization: `Bearer ${userA.token}` },
    });

    // User B accepts
    clearRateLimits();
    await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${userA.userId}`, {
      data: { type: 1 },
      headers: { Authorization: `Bearer ${userB.token}` },
    });

    // User A removes friend via API
    clearRateLimits();
    const removeRes = await apiWithRetry(request, 'delete', `${API_BASE}/users/@me/relationships/${userB.userId}`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    expect(removeRes.status).toBe(204);

    // Verify in UI - All friends should be empty
    await loginViaToken(page, userA.token, { email: userA.email, password: 'TestPass123A' });

    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await homeButton.click();

    await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: /^all$/i }).click();

    await expect(page.getByText("You don't have any friends yet.")).toBeVisible({ timeout: 10000 });
  });
});
