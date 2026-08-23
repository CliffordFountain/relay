import { test, expect } from '@playwright/test';
import {
  uniqueId,
  registerUser,
  registerUserWithGuild,
  clearRateLimits,
  loginViaToken,
  clickFirstGuild,
  apiWithRetry,
  API_BASE,
  getCurrentUserId,
  type GuildFixture,
  type UserFixture,
} from './helpers';

/**
 * Invite Flow E2E Tests
 *
 * Covers the full invite lifecycle: creation, acceptance, guild visibility,
 * messaging as a new member, invite revocation, and revoked invite rejection.
 *
 * Uses 3 real registered users across the test suite.
 */

const PASSWORD = 'TestPass123A';

test.describe('Invite Flow', () => {
  let ownerFixture: GuildFixture;
  let userB: UserFixture;
  let userC: UserFixture;
  let inviteCode: string;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    ownerFixture = await registerUserWithGuild(request, 'inv_owner');
    userB = await registerUser(request, 'inv_b');
    userC = await registerUser(request, 'inv_c');
  });

  // Test 1: Owner creates an invite via API on the guild's text channel
  test('owner creates an invite on a text channel', async ({ request }) => {
    const res = await apiWithRetry(request, 'post', `${API_BASE}/channels/${ownerFixture.channelId}/invites`, {
      data: { max_age: 86400, max_uses: 10 },
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });

    expect(res.ok).toBe(true);
    const data = await res.json() as { code: string; channel: { id: string }; guild: { id: string } };
    expect(data.code).toBeTruthy();
    expect(typeof data.code).toBe('string');
    expect(data.code.length).toBeGreaterThan(0);

    inviteCode = data.code;
  });

  // Test 2: Invite details can be fetched (the invite link is valid)
  test('invite code is fetchable and contains guild info', async ({ request }) => {
    const res = await apiWithRetry(request, 'get', `${API_BASE}/invites/${inviteCode}`, {
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });

    expect(res.ok).toBe(true);
    const data = await res.json() as { code: string; guild?: { id: string; name: string } };
    expect(data.code).toBe(inviteCode);

    if (data.guild) {
      expect(data.guild.id).toBe(ownerFixture.guildId);
    }
  });

  // Test 3: User B accepts the invite via API
  test('user B accepts the invite and joins the guild', async ({ request }) => {
    const res = await apiWithRetry(request, 'post', `${API_BASE}/invites/${inviteCode}`, {
      headers: { Authorization: `Bearer ${userB.token}` },
    });

    expect(res.ok).toBe(true);
    const data = await res.json() as { guild?: { id: string } };

    // Verify user B is now a member of the guild
    const userBId = await getCurrentUserId(request, userB.token);
    const memberRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/guilds/${ownerFixture.guildId}/members/${userBId}`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );

    expect(memberRes.ok).toBe(true);
    const memberData = await memberRes.json() as { user: { id: string } };
    expect(memberData.user.id).toBe(userBId);
  });

  // Test 4: User B logs in and sees the guild in the server sidebar
  test('user B sees the guild in server sidebar after accepting invite', async ({ page }) => {
    await loginViaToken(page, userB.token, { email: userB.email, password: PASSWORD });

    // The guild should appear in the server sidebar
    const guildItem = page.locator(
      `nav[aria-label="Servers"] [role="treeitem"][aria-label="${ownerFixture.guildName}"]`,
    );
    await expect(guildItem).toBeVisible({ timeout: 15000 });
  });

  // Test 5: User B can see channels and send a message
  test('user B can navigate to a channel and send a message', async ({ page }) => {
    await loginViaToken(page, userB.token, { email: userB.email, password: PASSWORD });

    // Click the guild in sidebar
    const guildItem = page.locator(
      `nav[aria-label="Servers"] [role="treeitem"][aria-label="${ownerFixture.guildName}"]`,
    );
    await expect(guildItem).toBeVisible({ timeout: 15000 });
    await guildItem.click();

    // Wait for channel list and click #general
    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });
    await generalChannel.click();

    // Message input should be available
    const input = page.locator('textarea[aria-label*="Message"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Send a message
    const messageText = `Hello from UserB ${uniqueId()}`;
    await input.fill(messageText);
    await input.press('Enter');

    // Message must appear in chat
    await expect(page.getByText(messageText)).toBeVisible({ timeout: 10000 });
  });

  // Test 6: Owner sees user B's message in the channel
  test('owner sees user B message in the channel', async ({ page, request }) => {
    // Verify via API that user B's message exists in the channel
    const messagesRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/channels/${ownerFixture.channelId}/messages?limit=10`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );

    expect(messagesRes.ok).toBe(true);
    const messages = await messagesRes.json() as Array<{ content: string; author: { username: string } }>;

    // Find a message authored by user B
    const userBMessage = messages.find(m => m.author.username === userB.username);
    expect(userBMessage).toBeTruthy();
  });

  // Test 7: Owner revokes (deletes) the invite
  test('owner revokes the invite', async ({ request }) => {
    const res = await apiWithRetry(request, 'delete', `${API_BASE}/invites/${inviteCode}`, {
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });

    // The the API returns 200 with the deleted invite object on successful revocation
    expect(res.ok).toBe(true);

    // Verify the invite is no longer valid by trying to fetch it
    const checkRes = await apiWithRetry(request, 'get', `${API_BASE}/invites/${inviteCode}`, {
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });

    // Should return 404 (invite not found) or 410 (gone)
    expect(checkRes.ok).toBe(false);
    expect([404, 410, 400]).toContain(checkRes.status);
  });

  // Test 8: User C tries to use the revoked invite - fails
  test('user C cannot use a revoked invite', async ({ request }) => {
    const res = await apiWithRetry(request, 'post', `${API_BASE}/invites/${inviteCode}`, {
      headers: { Authorization: `Bearer ${userC.token}` },
    });

    // Must fail - invite was revoked
    expect(res.ok).toBe(false);
    expect([404, 410, 400, 403]).toContain(res.status);

    // Verify user C is NOT a member of the guild
    const userCId = await getCurrentUserId(request, userC.token);
    const memberRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/guilds/${ownerFixture.guildId}/members/${userCId}`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );

    // Should fail - user C is not a member
    expect(memberRes.ok).toBe(false);
  });

  // Test 9: User C does not see the guild in their sidebar
  test('user C does not see the guild in their server sidebar', async ({ page }) => {
    await loginViaToken(page, userC.token, { email: userC.email, password: PASSWORD });

    // Wait for app to load
    const nav = page.locator('nav[aria-label="Servers"]');
    await expect(nav).toBeVisible({ timeout: 15000 });

    // The guild should NOT appear for user C
    const guildItem = nav.locator(`[role="treeitem"][aria-label="${ownerFixture.guildName}"]`);
    await expect(guildItem).not.toBeVisible({ timeout: 5000 });
  });

  // Test 10: Creating an invite with max_uses=1 is consumed after first use
  test('invite with max_uses=1 is consumed after one use', async ({ request }) => {
    // Create a single-use invite
    const res = await apiWithRetry(request, 'post', `${API_BASE}/channels/${ownerFixture.channelId}/invites`, {
      data: { max_age: 86400, max_uses: 1 },
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });
    expect(res.ok).toBe(true);
    const invite = await res.json() as { code: string };

    // User C uses it
    const acceptRes = await apiWithRetry(request, 'post', `${API_BASE}/invites/${invite.code}`, {
      headers: { Authorization: `Bearer ${userC.token}` },
    });
    expect(acceptRes.ok).toBe(true);

    // Create another user to test the consumed invite
    const userD = await registerUser(request, 'inv_d');
    const secondAcceptRes = await apiWithRetry(request, 'post', `${API_BASE}/invites/${invite.code}`, {
      headers: { Authorization: `Bearer ${userD.token}` },
    });

    // Should fail - invite is consumed
    expect(secondAcceptRes.ok).toBe(false);
    expect([404, 410, 400, 403]).toContain(secondAcceptRes.status);
  });
});
