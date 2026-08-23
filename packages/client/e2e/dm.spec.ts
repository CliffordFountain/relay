import { test, expect } from '@playwright/test';
import {
  uniqueId,
  registerUser,
  clearRateLimits,
  loginViaToken,
  apiWithRetry,
  API_BASE,
  getCurrentUserId,
  sendMessageViaAPI,
  type UserFixture,
} from './helpers';

/**
 * Direct Message (DM) E2E Tests
 *
 * Covers opening DM channels between 2 real users, sending messages,
 * verifying they appear in the chat, and closing DMs from the sidebar.
 */

const PASSWORD = 'TestPass123A';

test.describe('Direct Messages', () => {
  let userA: UserFixture & { userId: string };
  let userB: UserFixture & { userId: string };
  let dmChannelId: string;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();

    const rawA = await registerUser(request, 'dm_a');
    const aId = await getCurrentUserId(request, rawA.token);
    userA = { ...rawA, userId: aId };

    const rawB = await registerUser(request, 'dm_b');
    const bId = await getCurrentUserId(request, rawB.token);
    userB = { ...rawB, userId: bId };
  });

  // Test 1: User A opens a DM channel with User B via API
  test('user A opens a DM channel with user B via API', async ({ request }) => {
    const res = await apiWithRetry(request, 'post', `${API_BASE}/users/@me/channels`, {
      data: { recipient_id: userB.userId },
      headers: { Authorization: `Bearer ${userA.token}` },
    });

    expect(res.ok).toBe(true);
    const data = await res.json() as {
      id: string;
      type: number;
      recipients: Array<{ id: string; username: string }>;
    };

    expect(data.id).toBeTruthy();
    expect(data.type).toBe(1); // DM channel type
    expect(data.recipients.length).toBeGreaterThanOrEqual(1);

    dmChannelId = data.id;
  });

  // Test 2: DM channel appears in User A's DM list via API
  test('DM channel appears in user A DM list via API', async ({ request }) => {
    const res = await apiWithRetry(request, 'get', `${API_BASE}/users/@me/channels`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });

    expect(res.ok).toBe(true);
    const channels = await res.json() as Array<{ id: string; type: number }>;
    const foundDm = channels.find(c => c.id === dmChannelId);
    expect(foundDm).toBeDefined();
    expect(foundDm!.type).toBe(1);
  });

  // Test 3: User A sends a message in the DM via API
  test('user A sends a message in the DM', async ({ request }) => {
    const messageText = `Hello DM ${uniqueId()}`;
    const msg = await sendMessageViaAPI(request, userA.token, dmChannelId, messageText);

    expect(msg.id).toBeTruthy();
    expect(msg.content).toBe(messageText);

    // Verify the message is retrievable
    const messagesRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/channels/${dmChannelId}/messages?limit=5`,
      { headers: { Authorization: `Bearer ${userA.token}` } },
    );

    expect(messagesRes.ok).toBe(true);
    const messages = await messagesRes.json() as Array<{ id: string; content: string }>;
    const found = messages.find(m => m.content === messageText);
    expect(found).toBeDefined();
  });

  // Test 4: User B can also see the DM channel
  test('user B can see the DM channel in their channel list', async ({ request }) => {
    const res = await apiWithRetry(request, 'get', `${API_BASE}/users/@me/channels`, {
      headers: { Authorization: `Bearer ${userB.token}` },
    });

    expect(res.ok).toBe(true);
    const channels = await res.json() as Array<{ id: string; type: number }>;
    const foundDm = channels.find(c => c.id === dmChannelId);
    expect(foundDm).toBeDefined();
  });

  // Test 5: User B can read messages User A sent
  test('user B can read messages in the DM', async ({ request }) => {
    const messagesRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/channels/${dmChannelId}/messages?limit=10`,
      { headers: { Authorization: `Bearer ${userB.token}` } },
    );

    expect(messagesRes.ok).toBe(true);
    const messages = await messagesRes.json() as Array<{ content: string; author: { id: string } }>;

    // There should be at least one message from user A
    const fromA = messages.find(m => m.author.id === userA.userId);
    expect(fromA).toBeDefined();
  });

  // Test 6: User A logs in, sees DM in sidebar, clicks it, and sees the chat
  test('user A sees DM in sidebar and can open it', async ({ page }) => {
    await loginViaToken(page, userA.token, { email: userA.email, password: PASSWORD });

    // Click Home to navigate to DM view
    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await expect(homeButton).toBeVisible({ timeout: 15000 });
    await homeButton.click();

    // Wait for the DM sidebar to load
    await expect(
      page.locator('input[aria-label="Find or start a conversation"]'),
    ).toBeVisible({ timeout: 10000 });

    // DM with User B should appear in the sidebar
    const dmItem = page.locator(`[role="button"][aria-label*="Direct message with ${userB.username}"]`);
    await expect(dmItem).toBeVisible({ timeout: 10000 });

    // Click the DM to open the conversation
    await dmItem.click();

    // Chat area should load - look for the message input
    const input = page.locator('textarea[aria-label*="Message"]');
    await expect(input).toBeVisible({ timeout: 10000 });
  });

  // Test 7: User A sends a message in the DM via the UI
  test('user A sends a message in DM via UI', async ({ page }) => {
    await loginViaToken(page, userA.token, { email: userA.email, password: PASSWORD });

    // Navigate to Home / DM view
    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await expect(homeButton).toBeVisible({ timeout: 15000 });
    await homeButton.click();

    await expect(
      page.locator('input[aria-label="Find or start a conversation"]'),
    ).toBeVisible({ timeout: 10000 });

    // Click the DM with User B
    const dmItem = page.locator(`[role="button"][aria-label*="Direct message with ${userB.username}"]`);
    await expect(dmItem).toBeVisible({ timeout: 10000 });
    await dmItem.click();

    // Wait for message input
    const input = page.locator('textarea[aria-label*="Message"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Send a message
    const messageText = `DM UI msg ${uniqueId()}`;
    await input.fill(messageText);
    await input.press('Enter');

    // Message must appear in chat
    await expect(page.getByText(messageText)).toBeVisible({ timeout: 10000 });

    // Input should be cleared
    await expect(input).toHaveValue('');
  });

  // Test 8: User A closes the DM (X button) - DM disappears from sidebar
  test('user A closes DM via X button and it disappears from sidebar', async ({ page }) => {
    await loginViaToken(page, userA.token, { email: userA.email, password: PASSWORD });

    // Navigate to Home / DM view
    const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
    await expect(homeButton).toBeVisible({ timeout: 15000 });
    await homeButton.click();

    await expect(
      page.locator('input[aria-label="Find or start a conversation"]'),
    ).toBeVisible({ timeout: 10000 });

    // DM item should be visible
    const dmItem = page.locator(`[role="button"][aria-label*="Direct message with ${userB.username}"]`);
    await expect(dmItem).toBeVisible({ timeout: 10000 });

    // Click the close button (X) on the DM entry
    const closeBtn = page.locator(`[aria-label="Close DM with ${userB.username}"]`);
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    await closeBtn.click();

    // DM should disappear from the sidebar
    await expect(dmItem).not.toBeVisible({ timeout: 10000 });
  });

  // Test 9: After closing, the DM channel still exists on the server (not deleted)
  test('closed DM is still accessible via API (not permanently deleted)', async ({ request }) => {
    // The channel should still exist and be accessible
    const messagesRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/channels/${dmChannelId}/messages?limit=5`,
      { headers: { Authorization: `Bearer ${userA.token}` } },
    );

    expect(messagesRes.ok).toBe(true);
    const messages = await messagesRes.json() as Array<{ id: string }>;
    expect(messages.length).toBeGreaterThan(0);
  });

  // Test 10: Re-opening the DM (by creating it again) restores it
  test('re-opening the DM via API brings it back', async ({ request }) => {
    const res = await apiWithRetry(request, 'post', `${API_BASE}/users/@me/channels`, {
      data: { recipient_id: userB.userId },
      headers: { Authorization: `Bearer ${userA.token}` },
    });

    expect(res.ok).toBe(true);
    const data = await res.json() as { id: string; type: number };

    // Should return the same DM channel (DMs are reused, not recreated)
    expect(data.id).toBe(dmChannelId);
    expect(data.type).toBe(1);
  });

  // Test 11: User B can send messages back to User A in the DM
  test('user B can send messages in the DM', async ({ request }) => {
    const messageText = `Reply from B ${uniqueId()}`;
    const msg = await sendMessageViaAPI(request, userB.token, dmChannelId, messageText);

    expect(msg.id).toBeTruthy();
    expect(msg.content).toBe(messageText);
  });

  // Test 12: Both users' messages are visible in the channel
  test('DM contains messages from both users', async ({ request }) => {
    const messagesRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/channels/${dmChannelId}/messages?limit=50`,
      { headers: { Authorization: `Bearer ${userA.token}` } },
    );

    expect(messagesRes.ok).toBe(true);
    const messages = await messagesRes.json() as Array<{ author: { id: string }; content: string }>;

    const fromA = messages.filter(m => m.author.id === userA.userId);
    const fromB = messages.filter(m => m.author.id === userB.userId);

    expect(fromA.length).toBeGreaterThan(0);
    expect(fromB.length).toBeGreaterThan(0);
  });
});
