import { test, expect } from '@playwright/test';
import {
  uniqueId,
  registerUser,
  registerUserWithGuild,
  clearRateLimits,
  loginViaToken,
  clickFirstGuild,
  createRole,
  addRoleToMember,
  addMemberToGuild,
  openServerDropdown,
  apiWithRetry,
  API_BASE,
  type GuildFixture,
} from './helpers';

/**
 * Permissions E2E Tests
 *
 * Covers owner permissions, role creation, role assignment,
 * crown icon, and @everyone rename block.
 */

const PASSWORD = 'TestPass123A';

test.describe('Permissions', () => {
  let ownerFixture: GuildFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    ownerFixture = await registerUserWithGuild(request, 'perm');
  });

  // Test 1: Owner sees management options
  test('guild owner sees Server Settings in server dropdown', async ({ page }) => {
    await loginViaToken(page, ownerFixture.token, { email: ownerFixture.email, password: PASSWORD });
    await clickFirstGuild(page);
    await expect(page.locator('[role="button"][aria-label*="general" i]').first()).toBeVisible({ timeout: 10000 });

    await openServerDropdown(page);

    const dropdown = page.locator('[role="menu"]');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Owner must see "Server Settings" in the dropdown
    const serverSettingsItem = dropdown.locator('[role="menuitem"]').filter({ hasText: /server settings/i });
    await expect(serverSettingsItem).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
  });

  // Test 2: Create role via API
  test('create role via API returns 200 with role data', async ({ request }) => {
    const roleName = `TestRole_${uniqueId().slice(0, 6)}`;
    const role = await createRole(request, ownerFixture.token, ownerFixture.guildId, {
      name: roleName,
      permissions: (1 << 4).toString(), // MANAGE_CHANNELS
      color: 0xFF5733,
      hoist: true,
      mentionable: true,
    });

    expect(role.id).toBeTruthy();
    expect(role.name).toBe(roleName);

    // Verify role appears in guild roles list
    const rolesRes = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${ownerFixture.guildId}/roles`, {
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });

    expect(rolesRes.ok).toBe(true);
    const roles = await rolesRes.json() as Array<{ id: string; name: string }>;
    const found = roles.find(r => r.id === role.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe(roleName);
  });

  // Test 3: Assign role to member
  test('assign role to guild member via invite+API, verify member has role', async ({ request }) => {
    // Add a member to the guild via invite flow
    const member = await addMemberToGuild(request, ownerFixture.token, ownerFixture.guildId, 'rmember');

    // Create a role
    const roleName = `AssignRole_${uniqueId().slice(0, 5)}`;
    const role = await createRole(request, ownerFixture.token, ownerFixture.guildId, {
      name: roleName,
      permissions: '0',
      color: 0x3498DB,
      hoist: true,
    });

    // Assign role to member
    await addRoleToMember(request, ownerFixture.token, ownerFixture.guildId, member.userId, role.id);

    // Verify member has the role
    const memberRes = await apiWithRetry(
      request,
      'get',
      `${API_BASE}/guilds/${ownerFixture.guildId}/members/${member.userId}`,
      { headers: { Authorization: `Bearer ${ownerFixture.token}` } },
    );

    expect(memberRes.ok).toBe(true);
    const memberData = await memberRes.json() as { roles: string[] };
    expect(memberData.roles).toContain(role.id);
  });

  // Test 4: Crown icon on owner in member list
  test('guild owner has crown icon in member list', async ({ page }) => {
    await loginViaToken(page, ownerFixture.token, { email: ownerFixture.email, password: PASSWORD });
    await clickFirstGuild(page);

    const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
    await expect(generalChannel).toBeVisible({ timeout: 10000 });
    await generalChannel.click();

    // Wait for messages to load, then check member list
    await page.waitForSelector('text="Message #"', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Toggle member list open if needed
    const memberToggle = page.locator('[aria-label="Toggle member list"]');
    if (await memberToggle.isVisible().catch(() => false)) {
      const memberList = page.locator('[aria-label="Member list"]');
      if (!(await memberList.isVisible().catch(() => false))) {
        await memberToggle.click();
        await page.waitForTimeout(1000);
      }
    }

    // Look for the crown icon (could be SVG with role="img" or just aria-label)
    const crownIcon = page.locator('[aria-label="Server Owner"]');
    await expect(crownIcon.first()).toBeVisible({ timeout: 10000 });
  });

  // Test 5: @everyone rename blocked
  test('@everyone role rename is rejected by the API', async ({ request }) => {
    // Get guild roles to find @everyone
    const rolesRes = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${ownerFixture.guildId}/roles`, {
      headers: { Authorization: `Bearer ${ownerFixture.token}` },
    });

    expect(rolesRes.ok).toBe(true);
    const roles = await rolesRes.json() as Array<{ id: string; name: string }>;

    // @everyone role has the same ID as the guild
    const everyoneRole = roles.find(r => r.name === '@everyone' || r.id === ownerFixture.guildId);
    expect(everyoneRole).toBeDefined();

    // Try to rename @everyone -- should get a 400 or the API silently ignores the name change
    const renameRes = await apiWithRetry(
      request,
      'patch',
      `${API_BASE}/guilds/${ownerFixture.guildId}/roles/${everyoneRole!.id}`,
      {
        data: { name: 'renamed-everyone' },
        headers: { Authorization: `Bearer ${ownerFixture.token}` },
      },
    );

    if (renameRes.ok) {
      // If the API returns 200, the name must still be @everyone (silently ignored)
      const updatedRole = await renameRes.json() as { name: string };
      expect(updatedRole.name).toBe('@everyone');
    } else {
      // Otherwise expect a 400 or 403 rejection
      expect([400, 403]).toContain(renameRes.status);
    }
  });
});
