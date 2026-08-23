import { test, expect } from '@playwright/test';
import {
  API_BASE,
  registerUserWithGuild,
  loginViaToken,
  clickFirstGuild,
  apiWithRetry,
} from './helpers';

test.describe('Stage and Announcement Channels', () => {
  test('create stage channel via API and verify stage icon in sidebar', async ({ page, request }) => {
    const fixture = await registerUserWithGuild(request, 'stage');
    const { token, guildId } = fixture;

    // Create stage channel (type 13) via API
    const stageRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${guildId}/channels`, {
      data: { name: 'community-stage', type: 13 },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(stageRes.ok).toBe(true);

    // Login and navigate to the guild
    await loginViaToken(page, token, { email: fixture.email, password: 'TestPass123A' });
    await clickFirstGuild(page);

    // Verify stage channel appears in sidebar with the correct aria label
    const stageChannel = page.locator('[role="button"][aria-label*="Stage channel"]').first();
    await expect(stageChannel).toBeVisible({ timeout: 10000 });
    await expect(stageChannel).toContainText('community-stage');
  });

  test('create announcement channel via API and verify megaphone icon in sidebar', async ({ page, request }) => {
    const fixture = await registerUserWithGuild(request, 'announce');
    const { token, guildId } = fixture;

    // Create announcement channel (type 5) via API
    const announceRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${guildId}/channels`, {
      data: { name: 'news', type: 5 },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(announceRes.ok).toBe(true);

    // Login and navigate to the guild
    await loginViaToken(page, token, { email: fixture.email, password: 'TestPass123A' });
    await clickFirstGuild(page);

    // Verify announcement channel appears in sidebar with the correct aria label
    const announceChannel = page.locator('[role="button"][aria-label*="Announcement channel"]').first();
    await expect(announceChannel).toBeVisible({ timeout: 10000 });
    await expect(announceChannel).toContainText('news');
  });

  test('send message in announcement channel and verify Publish button visible', async ({ page, request }) => {
    const fixture = await registerUserWithGuild(request, 'pubtest');
    const { token, guildId } = fixture;

    // Create announcement channel (type 5)
    const announceRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${guildId}/channels`, {
      data: { name: 'announcements', type: 5 },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(announceRes.ok).toBe(true);
    const announceData = await announceRes.json() as { id: string };

    // Send a message in the announcement channel via API
    const msgRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${announceData.id}/messages`, {
      data: { content: 'Important news update' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(msgRes.ok).toBe(true);

    // Login and navigate to the guild
    await loginViaToken(page, token, { email: fixture.email, password: 'TestPass123A' });
    await clickFirstGuild(page);

    // Click the announcement channel
    const announceChannel = page.locator('[role="button"][aria-label*="Announcement channel"]').first();
    await expect(announceChannel).toBeVisible({ timeout: 10000 });
    await announceChannel.click();

    // Wait for message to appear
    await expect(page.getByText('Important news update')).toBeVisible({ timeout: 10000 });

    // Hover over the message to see action bar
    const messageText = page.getByText('Important news update');
    await messageText.hover();

    // Verify Publish button is visible in the action bar
    const publishBtn = page.locator('[data-testid="publish-btn"]');
    await expect(publishBtn).toBeVisible({ timeout: 5000 });
  });
});
