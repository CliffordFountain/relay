import { test, expect } from '@playwright/test';
import {
  uniqueId,
  registerUser,
  registerUserWithGuild,
  clearRateLimits,
  loginViaToken,
  apiWithRetry,
  API_BASE,
  getCurrentUserId,
  createRole,
  addRoleToMember,
  addMemberToGuild,
  type GuildFixture,
  type UserFixture,
} from './helpers';

/**
 * Roles & Permissions E2E Tests
 *
 * Tests the full role lifecycle with 2 real users:
 * - Role creation with specific permissions
 * - Role assignment and verification
 * - Sending messages with proper permissions
 * - Denying permissions via channel overwrites
 * - Removing roles and restoring access
 *
 * Uses these permission bitfield values:
 *   MANAGE_MESSAGES = 1 << 13 = 8192
 *   SEND_MESSAGES   = 1 << 11 = 2048
 *   VIEW_CHANNEL    = 1 << 10 = 1024
 */

const PASSWORD = 'TestPass123A';

// Permission bit values (as decimal strings for the API)
const SEND_MESSAGES = (1 << 11).toString();   // 2048
const MANAGE_MESSAGES = (1 << 13).toString();  // 8192
const VIEW_CHANNEL = (1 << 10).toString();     // 1024

test.describe('Roles & Permissions', () => {
  let ownerFixture: GuildFixture;
  let memberFixture: UserFixture & { userId: string };
  let moderatorRoleId: string;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    // User A creates a guild
    ownerFixture = await registerUserWithGuild(request, 'rperm_owner');
    // User B joins via invite
    memberFixture = await addMemberToGuild(
      request,
      ownerFixture.token,
      ownerFixture.guildId,
      'rperm_member',
    );
  });

  // Test 1: Owner creates a "Moderator" role with MANAGE_MESSAGES permission
  test('owner creates a Moderator role with MANAGE_MESSAGES', async ({ request }) => {
    const roleName = `Moderator_${uniqueId().slice(0, 5)}`;
    const role = await createRole(request, ownerFixture.token, ownerFixture.guildId, {
      name: roleName,
      permissions: MANAGE_MESSAGES,
      color: 0x2ECC71,
      hoist: true,
      mentionable: true,
    });

    expect(role.id).toBeTruthy();
    expect(role.name).toBe(roleName);

    moderatorRoleId = role.id;

    // Verify role exists in guild roles list
    const rolesRes = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${ownerFixture.guildId}/roles`, {
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });
    expect(rolesRes.ok).toBe(true);
    const roles = await rolesRes.json() as Array<{ id: string; name: string }>;
    const found = roles.find(r => r.id === role.id);
    expect(found).toBeDefined();
  });

  // Test 2: Owner assigns Moderator role to User B
  test('owner assigns Moderator role to member', async ({ request }) => {
    await addRoleToMember(
      request,
      ownerFixture.token,
      ownerFixture.guildId,
      memberFixture.userId,
      moderatorRoleId,
    );

    // Verify the member now has the role
    const memberRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/guilds/${ownerFixture.guildId}/members/${memberFixture.userId}`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );
    expect(memberRes.ok).toBe(true);
    const memberData = await memberRes.json() as { roles: string[] };
    expect(memberData.roles).toContain(moderatorRoleId);
  });

  // Test 3: User B logs in and can see the channel
  test('member can see channels in the guild', async ({ page }) => {
    await loginViaToken(page, memberFixture.token, { email: memberFixture.email, password: PASSWORD });

    // Navigate to the guild
    const guildItem = page.locator(
      `nav[aria-label="Servers"] [role="treeitem"][aria-label="${ownerFixture.guildName}"]`,
    );
    await expect(guildItem).toBeVisible({ timeout: 15000 });
    await guildItem.click();

    // Channel list should have #general
    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });
  });

  // Test 4: User B sends a message (has SEND_MESSAGES from @everyone)
  test('member can send a message in the channel', async ({ page }) => {
    await loginViaToken(page, memberFixture.token, { email: memberFixture.email, password: PASSWORD });

    // Navigate to guild and channel
    const guildItem = page.locator(
      `nav[aria-label="Servers"] [role="treeitem"][aria-label="${ownerFixture.guildName}"]`,
    );
    await expect(guildItem).toBeVisible({ timeout: 15000 });
    await guildItem.click();

    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });
    await generalChannel.click();

    const input = page.locator('textarea[aria-label*="Message"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    const messageText = `MemberMsg_${uniqueId()}`;
    await input.fill(messageText);
    await input.press('Enter');

    await expect(page.getByText(messageText)).toBeVisible({ timeout: 10000 });
  });

  // Test 5: Member can send messages via API (baseline before deny)
  test('member can send messages via API before permission deny', async ({ request }) => {
    const messageText = `APImsg_${uniqueId()}`;
    const res = await apiWithRetry(
      request,
      'post',
      `${API_BASE}/channels/${ownerFixture.channelId}/messages`,
      {
        data: { content: messageText },
        headers: { Authorization: `Bearer ${memberFixture.token}` },
      },
    );

    expect(res.ok).toBe(true);
    const data = await res.json() as { id: string; content: string };
    expect(data.content).toBe(messageText);
  });

  // Test 6: Owner creates a channel permission overwrite denying SEND_MESSAGES for a "Muted" role
  test('owner creates Muted role and denies SEND_MESSAGES via channel overwrite', async ({ request }) => {
    // Create the "Muted" role
    const mutedRoleName = `Muted_${uniqueId().slice(0, 5)}`;
    const mutedRole = await createRole(request, ownerFixture.token, ownerFixture.guildId, {
      name: mutedRoleName,
      permissions: '0',
      color: 0x95A5A6,
    });
    expect(mutedRole.id).toBeTruthy();

    // Create a channel permission overwrite that denies SEND_MESSAGES for this role
    // PUT /channels/{channel.id}/permissions/{overwrite.id}
    // type 0 = role overwrite
    const overwriteRes = await apiWithRetry(
      request,
      'put',
      `${API_BASE}/channels/${ownerFixture.channelId}/permissions/${mutedRole.id}`,
      {
        data: {
          type: 0, // role
          allow: '0',
          deny: SEND_MESSAGES, // deny SEND_MESSAGES
        },
        headers: { Authorization: `Bearer ${ownerFixture.token}` },
      },
    );

    expect(overwriteRes.ok).toBe(true);

    // Assign the Muted role to User B
    await addRoleToMember(
      request,
      ownerFixture.token,
      ownerFixture.guildId,
      memberFixture.userId,
      mutedRole.id,
    );

    // Verify user B now has the Muted role
    const memberRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/guilds/${ownerFixture.guildId}/members/${memberFixture.userId}`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );
    expect(memberRes.ok).toBe(true);
    const memberData = await memberRes.json() as { roles: string[] };
    expect(memberData.roles).toContain(mutedRole.id);

    // Store the muted role ID for later tests
    // Use a test-scoped variable via test.info
    test.info().annotations.push({ type: 'mutedRoleId', description: mutedRole.id });
  });

  // Test 7: User B tries to send a message - should get a 403 error
  test('member with Muted role cannot send messages (API returns 403)', async ({ request }) => {
    const messageText = `ShouldFail_${uniqueId()}`;
    const res = await apiWithRetry(
      request,
      'post',
      `${API_BASE}/channels/${ownerFixture.channelId}/messages`,
      {
        data: { content: messageText },
        headers: { Authorization: `Bearer ${memberFixture.token}` },
      },
    );

    // Must fail with 403 (Missing Permissions) since SEND_MESSAGES is denied
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  // Test 8: Owner removes the Muted role from User B
  test('owner removes Muted role from member', async ({ request }) => {
    // Get the muted role ID from the guild's roles
    const rolesRes = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${ownerFixture.guildId}/roles`, {
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });
    expect(rolesRes.ok).toBe(true);
    const roles = await rolesRes.json() as Array<{ id: string; name: string }>;
    const mutedRole = roles.find(r => r.name.startsWith('Muted_'));
    expect(mutedRole).toBeDefined();

    // Remove the role: DELETE /guilds/{guild.id}/members/{user.id}/roles/{role.id}
    const removeRes = await apiWithRetry(
      request,
      'delete',
      `${API_BASE}/guilds/${ownerFixture.guildId}/members/${memberFixture.userId}/roles/${mutedRole!.id}`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );

    expect(removeRes.ok).toBe(true);

    // Verify the member no longer has the Muted role
    const memberRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/guilds/${ownerFixture.guildId}/members/${memberFixture.userId}`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );
    expect(memberRes.ok).toBe(true);
    const memberData = await memberRes.json() as { roles: string[] };
    expect(memberData.roles).not.toContain(mutedRole!.id);
  });

  // Test 9: User B can send messages again after Muted role is removed
  test('member can send messages again after Muted role removal', async ({ request }) => {
    const messageText = `UnmutedMsg_${uniqueId()}`;
    const res = await apiWithRetry(
      request,
      'post',
      `${API_BASE}/channels/${ownerFixture.channelId}/messages`,
      {
        data: { content: messageText },
        headers: { Authorization: `Bearer ${memberFixture.token}` },
      },
    );

    expect(res.ok).toBe(true);
    const data = await res.json() as { id: string; content: string };
    expect(data.content).toBe(messageText);
  });

  // Test 10: User B can send messages via UI after unmute
  test('member can send messages via UI after unmute', async ({ page }) => {
    await loginViaToken(page, memberFixture.token, { email: memberFixture.email, password: PASSWORD });

    const guildItem = page.locator(
      `nav[aria-label="Servers"] [role="treeitem"][aria-label="${ownerFixture.guildName}"]`,
    );
    await expect(guildItem).toBeVisible({ timeout: 15000 });
    await guildItem.click();

    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });
    await generalChannel.click();

    const input = page.locator('textarea[aria-label*="Message"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    const messageText = `BackToNormal_${uniqueId()}`;
    await input.fill(messageText);
    await input.press('Enter');

    await expect(page.getByText(messageText)).toBeVisible({ timeout: 10000 });
  });

  // Test 11: Non-member cannot access guild channels
  test('non-member cannot access guild channels via API', async ({ request }) => {
    const outsider = await registerUser(request, 'rperm_out');

    const res = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/guilds/${ownerFixture.guildId}/channels`,
      { headers: { Authorization: `Bearer ${outsider.token}` } },
    );

    // Non-members should get 403 or 404
    expect(res.ok).toBe(false);
    expect([403, 404]).toContain(res.status);
  });

  // Test 12: Non-member cannot send messages in guild channels
  test('non-member cannot send messages in guild channels', async ({ request }) => {
    const outsider = await registerUser(request, 'rperm_out2');
    const messageText = `Unauthorized_${uniqueId()}`;

    const res = await apiWithRetry(
      request,
      'post',
      `${API_BASE}/channels/${ownerFixture.channelId}/messages`,
      {
        data: { content: messageText },
        headers: { Authorization: `Bearer ${outsider.token}` },
      },
    );

    expect(res.ok).toBe(false);
    expect([403, 404]).toContain(res.status);
  });
});
