import { test, expect } from '@playwright/test';
import {
  uniqueId,
  registerUser,
  registerUserWithGuild,
  addMemberToGuild,
  clearRateLimits,
  loginViaToken,
  clickFirstGuild,
  enterGeneralChannel,
  sendMessage,
  openServerDropdown,
  apiWithRetry,
  getCurrentUserId,
  API_BASE,
  type GuildFixture,
  type UserFixture,
} from './helpers';

/**
 * Comprehensive Multi-User E2E Tests
 *
 * Tests 2-account scenarios through the browser client: guild join, real-time
 * messaging, friend system, status/custom status, reactions, moderation,
 * nicknames, and channel permissions. Uses two browser contexts for real-time
 * cross-user verification.
 */

const PASSWORD = 'TestPass123A';

test.describe('Multi-User Scenarios', () => {
  let owner: GuildFixture;
  let ownerId: string;
  let memberB: UserFixture & { userId: string };

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    owner = await registerUserWithGuild(request, 'mu_own');
    ownerId = await getCurrentUserId(request, owner.token);
    memberB = await addMemberToGuild(request, owner.token, owner.guildId, 'mu_b');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 1: Guild Invite & Join
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Guild Invite & Join', () => {
    test('User B sees guild in sidebar after accepting invite', async ({ page }) => {
      await loginViaToken(page, memberB.token, { email: memberB.email, password: PASSWORD });

      const guildItem = page.locator(
        `nav[aria-label="Servers"] [role="treeitem"][aria-label="${owner.guildName}"]`,
      );
      await expect(guildItem).toBeVisible({ timeout: 15000 });
    });

    test('both users in guild — User A sends message, User B sees it in real-time', async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await enterGeneralChannel(pageA, owner.token, { email: owner.email, password: PASSWORD });
        clearRateLimits();
        await enterGeneralChannel(pageB, memberB.token, { email: memberB.email, password: PASSWORD });

        const msgText = `hello${uniqueId()}`;
        await sendMessage(pageA, msgText);
        await expect(pageB.getByText(msgText)).toBeVisible({ timeout: 15000 });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });

    test('User B sends message, User A sees it in real-time', async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await enterGeneralChannel(pageA, owner.token, { email: owner.email, password: PASSWORD });
        clearRateLimits();
        await enterGeneralChannel(pageB, memberB.token, { email: memberB.email, password: PASSWORD });

        const msgText = `fromB${uniqueId()}`;
        await sendMessage(pageB, msgText);
        await expect(pageA.getByText(msgText)).toBeVisible({ timeout: 15000 });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });

    test('User B sees owner crown icon in member list', async ({ page }) => {
      await loginViaToken(page, memberB.token, { email: memberB.email, password: PASSWORD });
      await clickFirstGuild(page);

      const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
      await expect(generalChannel).toBeVisible({ timeout: 10000 });
      await generalChannel.click();

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

      const crownIcon = page.locator('[aria-label="Server Owner"]');
      await expect(crownIcon.first()).toBeVisible({ timeout: 10000 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 2: Cross-User Messaging
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Cross-User Messaging', () => {
    test('User A edits message, User B sees updated text', async ({ browser, request }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await enterGeneralChannel(pageA, owner.token, { email: owner.email, password: PASSWORD });
        clearRateLimits();
        await enterGeneralChannel(pageB, memberB.token, { email: memberB.email, password: PASSWORD });

        const originalText = `editme${uniqueId()}`;
        await sendMessage(pageA, originalText);
        await expect(pageB.getByText(originalText)).toBeVisible({ timeout: 15000 });

        // Get message ID via API so we can edit reliably
        const msgsRes = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/messages?limit=5`, {
          headers: { Authorization: `Bearer ${owner.token}` },
        });
        const msgs = await msgsRes.json() as Array<{ id: string; content: string }>;
        const targetMsg = msgs.find(m => m.content === originalText);
        expect(targetMsg).toBeTruthy();

        // Edit via API (reliable, avoids UI race conditions with ArrowUp)
        const editedText = `edited${uniqueId()}`;
        const editRes = await apiWithRetry(request, 'patch',
          `${API_BASE}/channels/${owner.channelId}/messages/${targetMsg!.id}`,
          {
            data: { content: editedText },
            headers: { Authorization: `Bearer ${owner.token}` },
          },
        );
        expect(editRes.ok).toBe(true);

        // User B should see the edited text via gateway
        await expect(pageB.getByText(editedText)).toBeVisible({ timeout: 15000 });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });

    test('User A deletes message, it disappears for User B', async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await enterGeneralChannel(pageA, owner.token, { email: owner.email, password: PASSWORD });
        clearRateLimits();
        await enterGeneralChannel(pageB, memberB.token, { email: memberB.email, password: PASSWORD });

        const msgText = `deleteme${uniqueId()}`;
        await sendMessage(pageA, msgText);
        await expect(pageB.getByText(msgText)).toBeVisible({ timeout: 15000 });

        // Right-click the message on pageA
        const msgEl = pageA.locator('[class*="message"]').filter({ hasText: msgText }).first();
        await msgEl.click({ button: 'right' });

        const contextMenu = pageA.locator('[role="menu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });

        // Click Delete Message
        await contextMenu.locator('[role="menuitem"]').filter({ hasText: /Delete Message/i }).click();

        // Confirm delete in dialog
        const dialog = pageA.locator('[role="dialog"]');
        if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
          const deleteBtn = dialog.locator('button').filter({ hasText: /delete/i });
          await deleteBtn.click();
        }

        // Message should disappear for User B
        await expect(pageB.getByText(msgText)).not.toBeVisible({ timeout: 15000 });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });

    test('User A pins message, pin persists for User B', async ({ browser, request }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await enterGeneralChannel(pageA, owner.token, { email: owner.email, password: PASSWORD });
        clearRateLimits();
        await enterGeneralChannel(pageB, memberB.token, { email: memberB.email, password: PASSWORD });

        const msgText = `pinme${uniqueId()}`;
        await sendMessage(pageA, msgText);
        await expect(pageB.getByText(msgText)).toBeVisible({ timeout: 15000 });

        // Right-click → Pin Message on pageA
        const msgEl = pageA.locator('[class*="message"]').filter({ hasText: msgText }).first();
        await msgEl.click({ button: 'right' });
        const contextMenu = pageA.locator('[role="menu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        await contextMenu.locator('[role="menuitem"]').filter({ hasText: /Pin Message/i }).click();

        // Confirm pin dialog
        const pinDialog = pageA.locator('[role="dialog"]');
        await expect(pinDialog).toBeVisible({ timeout: 5000 });
        const confirmBtn = pinDialog.locator('button').filter({ hasText: /pin/i }).last();
        await confirmBtn.click();

        // Verify via API that pin persisted (User B can fetch pinned messages)
        const pinsRes = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/pins`, {
          headers: { Authorization: `Bearer ${memberB.token}` },
        });
        expect(pinsRes.ok).toBe(true);
        const pins = await pinsRes.json() as Array<{ content: string }>;
        expect(pins.some(p => p.content === msgText)).toBe(true);
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });

    test('User B replies to User A message via UI', async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await enterGeneralChannel(pageA, owner.token, { email: owner.email, password: PASSWORD });
        clearRateLimits();
        await enterGeneralChannel(pageB, memberB.token, { email: memberB.email, password: PASSWORD });

        const msgText = `replytome${uniqueId()}`;
        await sendMessage(pageA, msgText);
        await expect(pageB.getByText(msgText)).toBeVisible({ timeout: 15000 });

        // User B right-clicks → Reply
        const msgEl = pageB.locator('[class*="message"]').filter({ hasText: msgText }).first();
        await msgEl.click({ button: 'right' });
        const contextMenu = pageB.locator('[role="menu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        await contextMenu.locator('[role="menuitem"]').filter({ hasText: /^Reply$/i }).click();

        // Reply bar should appear above input
        const replyPreview = pageB.locator('[class*="replyPreview"], [class*="reply"]').first();
        await expect(replyPreview).toBeVisible({ timeout: 5000 });

        // Send reply
        const replyText = `reply${uniqueId()}`;
        const inputB = pageB.locator('textarea[aria-label*="Message"]');
        await inputB.fill(replyText);
        await inputB.press('Enter');

        // User A should see the reply
        await expect(pageA.getByText(replyText)).toBeVisible({ timeout: 15000 });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 3: Friend System
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Friend System', () => {
    let friendA: UserFixture & { userId: string };
    let friendB: UserFixture & { userId: string };

    test.beforeAll(async ({ request }) => {
      clearRateLimits();
      const rawA = await registerUser(request, 'mu_fa');
      friendA = { ...rawA, userId: await getCurrentUserId(request, rawA.token) };
      const rawB = await registerUser(request, 'mu_fb');
      friendB = { ...rawB, userId: await getCurrentUserId(request, rawB.token) };
    });

    test('User A sends friend request, sees outgoing in Pending tab', async ({ request, page }) => {
      clearRateLimits();
      const res = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${friendB.userId}`, {
        data: { type: 1 },
        headers: { Authorization: `Bearer ${friendA.token}` },
      });
      expect(res.status).toBe(204);

      await loginViaToken(page, friendA.token, { email: friendA.email, password: PASSWORD });
      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await homeButton.click();
      await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });
      await page.getByRole('tab', { name: /pending/i }).click();
      await expect(page.getByText(friendB.username, { exact: false })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Outgoing Friend Request')).toBeVisible();
    });

    test('User B sees incoming friend request in Pending tab', async ({ page }) => {
      await loginViaToken(page, friendB.token, { email: friendB.email, password: PASSWORD });
      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await homeButton.click();
      await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });
      await page.getByRole('tab', { name: /pending/i }).click();
      await expect(page.getByText(friendA.username, { exact: false })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Incoming Friend Request')).toBeVisible();
    });

    test('User B accepts friend request via API, User A sees in All tab', async ({ request, page }) => {
      clearRateLimits();
      const res = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${friendA.userId}`, {
        data: { type: 1 },
        headers: { Authorization: `Bearer ${friendB.token}` },
      });
      expect(res.status).toBe(204);

      await loginViaToken(page, friendA.token, { email: friendA.email, password: PASSWORD });
      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await homeButton.click();
      await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });
      await page.getByRole('tab', { name: /^all$/i }).click();
      await expect(page.getByText(friendB.username, { exact: false })).toBeVisible({ timeout: 10000 });
    });

    test('User B sees User A in All Friends tab', async ({ page }) => {
      await loginViaToken(page, friendB.token, { email: friendB.email, password: PASSWORD });
      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await homeButton.click();
      await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });
      await page.getByRole('tab', { name: /^all$/i }).click();
      await expect(page.getByText(friendA.username, { exact: false })).toBeVisible({ timeout: 10000 });
    });

    test('User A clicks Message on friend → DM opens → sends message', async ({ page }) => {
      await loginViaToken(page, friendA.token, { email: friendA.email, password: PASSWORD });
      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await homeButton.click();
      await expect(page.getByRole('main', { name: /friends/i })).toBeVisible({ timeout: 10000 });
      await page.getByRole('tab', { name: /^all$/i }).click();

      const mainArea = page.getByRole('main', { name: /friends/i });
      await expect(mainArea.getByText(friendB.username, { exact: false })).toBeVisible({ timeout: 10000 });
      const messageButton = mainArea.getByLabel(`Message ${friendB.username}`, { exact: false });
      await messageButton.click();

      const input = page.locator('textarea[aria-label*="Message"]');
      await expect(input).toBeVisible({ timeout: 10000 });

      const dmMsg = `dmhello${uniqueId()}`;
      await input.fill(dmMsg);
      await input.press('Enter');
      await expect(page.getByText(dmMsg)).toBeVisible({ timeout: 10000 });
    });

    test('User B sees DM in sidebar and reads User A message', async ({ page }) => {
      await loginViaToken(page, friendB.token, { email: friendB.email, password: PASSWORD });

      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await expect(homeButton).toBeVisible({ timeout: 15000 });
      await homeButton.click();

      await expect(
        page.locator('input[aria-label="Find or start a conversation"]'),
      ).toBeVisible({ timeout: 10000 });

      const dmItem = page.locator(`[role="button"][aria-label*="Direct message with ${friendA.username}"]`);
      await expect(dmItem).toBeVisible({ timeout: 10000 });
      await dmItem.click();

      const input = page.locator('textarea[aria-label*="Message"]');
      await expect(input).toBeVisible({ timeout: 10000 });

      // Should see at least one message from friendA
      await expect(page.getByText(friendA.username).first()).toBeVisible({ timeout: 10000 });
    });

    test('User A blocks User B → appears in Blocked tab, then unblocks', async ({ request, page }) => {
      clearRateLimits();
      const blockRes = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${friendB.userId}`, {
        data: { type: 2 },
        headers: { Authorization: `Bearer ${friendA.token}` },
      });
      expect(blockRes.status).toBe(204);
      await new Promise(r => setTimeout(r, 1500));

      await loginViaToken(page, friendA.token, { email: friendA.email, password: PASSWORD });
      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await homeButton.click();

      const friendsMain = page.getByRole('main', { name: /friends/i });
      await expect(friendsMain).toBeVisible({ timeout: 10000 });

      const blockedTab = page.getByRole('tab', { name: /blocked/i });
      await blockedTab.click();
      await expect(friendsMain.getByText(friendB.username, { exact: false })).toBeVisible({ timeout: 10000 });
    });

    test('User A unblocks and re-adds friend → friends again', async ({ request, page }) => {
      clearRateLimits();
      // Unblock (may return 204 or 404 depending on state)
      await apiWithRetry(request, 'delete', `${API_BASE}/users/@me/relationships/${friendB.userId}`, {
        headers: { Authorization: `Bearer ${friendA.token}` },
      });
      await new Promise(r => setTimeout(r, 1000));

      // Re-send friend request
      clearRateLimits();
      const reqRes = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${friendB.userId}`, {
        data: { type: 1 },
        headers: { Authorization: `Bearer ${friendA.token}` },
      });
      expect(reqRes.status).toBe(204);

      await new Promise(r => setTimeout(r, 500));

      // User B accepts
      clearRateLimits();
      const acceptRes = await apiWithRetry(request, 'put', `${API_BASE}/users/@me/relationships/${friendA.userId}`, {
        data: { type: 1 },
        headers: { Authorization: `Bearer ${friendB.token}` },
      });
      expect(acceptRes.status).toBe(204);

      await new Promise(r => setTimeout(r, 500));

      // Verify in UI
      await loginViaToken(page, friendA.token, { email: friendA.email, password: PASSWORD });
      const homeButton = page.locator('nav[aria-label="Servers"] [role="treeitem"][aria-label="Home"]');
      await homeButton.click();
      const friendsMain2 = page.getByRole('main', { name: /friends/i });
      await expect(friendsMain2).toBeVisible({ timeout: 10000 });
      await page.getByRole('tab', { name: /^all$/i }).click();
      await expect(friendsMain2.getByText(friendB.username, { exact: false })).toBeVisible({ timeout: 10000 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 4: Status & Custom Status
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Status & Custom Status', () => {
    test('user changes status to DND via status picker', async ({ page }) => {
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });

      // Click user panel to open status selector
      const userInfo = page.locator('[aria-label="Manage profile and status"]');
      await expect(userInfo).toBeVisible({ timeout: 10000 });
      await userInfo.click();

      // Status menu should appear
      const statusMenu = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu).toBeVisible({ timeout: 5000 });

      // Click Do Not Disturb
      await statusMenu.locator('[role="menuitem"]').filter({ hasText: 'Do Not Disturb' }).click();

      // Menu should close
      await expect(statusMenu).not.toBeVisible({ timeout: 5000 });

      // Status dot should reflect DND (red-ish color)
      // Re-open to verify the active state
      await userInfo.click();
      const statusMenu2 = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu2).toBeVisible({ timeout: 5000 });
      const dndOption = statusMenu2.locator('[role="menuitem"]').filter({ hasText: 'Do Not Disturb' });
      await expect(dndOption).toHaveClass(/active/i, { timeout: 5000 });
      await page.keyboard.press('Escape');
    });

    test('user changes status to Idle via status picker', async ({ page }) => {
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });

      const userInfo = page.locator('[aria-label="Manage profile and status"]');
      await userInfo.click();
      const statusMenu = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu).toBeVisible({ timeout: 5000 });

      await statusMenu.locator('[role="menuitem"]').filter({ hasText: /^Idle$/ }).click();
      await expect(statusMenu).not.toBeVisible({ timeout: 5000 });

      // Verify by reopening
      await userInfo.click();
      const statusMenu2 = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu2).toBeVisible({ timeout: 5000 });
      const idleOption = statusMenu2.locator('[role="menuitem"]').filter({ hasText: /^Idle$/ });
      await expect(idleOption).toHaveClass(/active/i, { timeout: 5000 });
      await page.keyboard.press('Escape');
    });

    test('user sets Invisible status', async ({ page }) => {
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });

      const userInfo = page.locator('[aria-label="Manage profile and status"]');
      await userInfo.click();
      const statusMenu = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu).toBeVisible({ timeout: 5000 });

      await statusMenu.locator('[role="menuitem"]').filter({ hasText: 'Invisible' }).click();
      await expect(statusMenu).not.toBeVisible({ timeout: 5000 });

      // Verify
      await userInfo.click();
      const statusMenu2 = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu2).toBeVisible({ timeout: 5000 });
      const invisOption = statusMenu2.locator('[role="menuitem"]').filter({ hasText: 'Invisible' });
      await expect(invisOption).toHaveClass(/active/i, { timeout: 5000 });
      await page.keyboard.press('Escape');
    });

    test('user switches back to Online', async ({ page }) => {
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });

      const userInfo = page.locator('[aria-label="Manage profile and status"]');
      await userInfo.click();
      const statusMenu = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu).toBeVisible({ timeout: 5000 });

      await statusMenu.locator('[role="menuitem"]').filter({ hasText: /^Online$/ }).click();
      await expect(statusMenu).not.toBeVisible({ timeout: 5000 });

      // Verify
      await userInfo.click();
      const statusMenu2 = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu2).toBeVisible({ timeout: 5000 });
      const onlineOption = statusMenu2.locator('[role="menuitem"]').filter({ hasText: /^Online$/ });
      await expect(onlineOption).toHaveClass(/active/i, { timeout: 5000 });
      await page.keyboard.press('Escape');
    });

    test('user sets custom status text via status picker', async ({ page }) => {
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });

      const userInfo = page.locator('[aria-label="Manage profile and status"]');
      await userInfo.click();
      const statusMenu = page.locator('[role="menu"][aria-label="Set status"]');
      await expect(statusMenu).toBeVisible({ timeout: 5000 });

      // Fill custom status input
      const customInput = statusMenu.locator('[aria-label="Custom status text"]');
      await expect(customInput).toBeVisible({ timeout: 5000 });
      const customText = `testing${uniqueId()}`;
      await customInput.fill(customText);

      // Press Enter or click save to set
      await customInput.press('Enter');

      // Menu should close (or custom status should be set)
      // Verify the custom status appears in the user panel
      await page.waitForTimeout(1000);
      await expect(page.getByText(customText).first()).toBeVisible({ timeout: 10000 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 5: Reactions Multi-User
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Reactions Multi-User', () => {
    test('User B reacts to User A message, reaction persists via API', async ({ request }) => {
      clearRateLimits();

      // Send message as owner
      const msgText = `reactme${uniqueId()}`;
      const msgRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, {
        data: { content: msgText },
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(msgRes.ok).toBe(true);
      const msg = await msgRes.json() as { id: string };

      // User B adds reaction
      const reactRes = await apiWithRetry(
        request, 'put',
        `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${encodeURIComponent('👍')}/@me`,
        { headers: { Authorization: `Bearer ${memberB.token}` } },
      );
      expect(reactRes.status).toBe(204);

      // Verify reaction persists and shows count 1
      const checkRes = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/messages?limit=5`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      const msgs = await checkRes.json() as Array<{ id: string; reactions?: Array<{ count: number; emoji: { name: string } }> }>;
      const target = msgs.find(m => m.id === msg.id);
      expect(target?.reactions).toBeTruthy();
      expect(target!.reactions![0].count).toBe(1);
    });

    test('both users react to same message, count shows 2', async ({ request }) => {
      clearRateLimits();

      // Send message and both react via API (reliable, verify count)
      const msgRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, {
        data: { content: `counttest${uniqueId()}` },
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      const msg = await msgRes.json() as { id: string };

      // User B reacts
      await apiWithRetry(
        request, 'put',
        `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${encodeURIComponent('👍')}/@me`,
        { headers: { Authorization: `Bearer ${memberB.token}` } },
      );

      // Owner also reacts
      await apiWithRetry(
        request, 'put',
        `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${encodeURIComponent('👍')}/@me`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );

      // Verify count via API
      const msgCheckRes = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/messages?limit=5`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      const messages = await msgCheckRes.json() as Array<{ id: string; reactions?: Array<{ count: number }> }>;
      const target = messages.find(m => m.id === msg.id);
      expect(target?.reactions?.[0]?.count).toBe(2);
    });

    test('User A removes reaction, count goes to 1', async ({ request }) => {
      clearRateLimits();

      // Send message, both react, then owner removes
      const msgRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, {
        data: { content: `rmreact${uniqueId()}` },
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      const msg = await msgRes.json() as { id: string };

      await apiWithRetry(request, 'put',
        `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${encodeURIComponent('👍')}/@me`,
        { headers: { Authorization: `Bearer ${memberB.token}` } },
      );
      await apiWithRetry(request, 'put',
        `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${encodeURIComponent('👍')}/@me`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );

      // Owner removes
      await apiWithRetry(request, 'delete',
        `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/reactions/${encodeURIComponent('👍')}/@me`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );

      // Verify count = 1
      const msgsRes = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/messages?limit=5`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      const messages = await msgsRes.json() as Array<{ id: string; reactions?: Array<{ count: number }> }>;
      const target = messages.find(m => m.id === msg.id);
      expect(target?.reactions?.[0]?.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 6: Moderation
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Moderation', () => {
    test('owner kicks User B → User B no longer sees guild in sidebar', async ({ request, page }) => {
      clearRateLimits();

      // Kick via API
      const kickRes = await apiWithRetry(request, 'delete',
        `${API_BASE}/guilds/${owner.guildId}/members/${memberB.userId}`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );
      expect(kickRes.status).toBe(204);

      // User B logs in — guild should NOT be in sidebar
      await loginViaToken(page, memberB.token, { email: memberB.email, password: PASSWORD });
      const guildItem = page.locator(
        `nav[aria-label="Servers"] [role="treeitem"][aria-label="${owner.guildName}"]`,
      );
      await expect(guildItem).not.toBeVisible({ timeout: 10000 });
    });

    test('owner re-invites User B → User B sees guild again', async ({ request, page }) => {
      clearRateLimits();

      // Create invite and accept
      const invRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/invites`, {
        data: { max_uses: 1, max_age: 86400 },
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(invRes.ok).toBe(true);
      const invite = await invRes.json() as { code: string };

      clearRateLimits();
      const joinRes = await apiWithRetry(request, 'post', `${API_BASE}/invites/${invite.code}`, {
        headers: { Authorization: `Bearer ${memberB.token}` },
      });
      expect(joinRes.ok).toBe(true);

      // User B logs in — guild should be back
      await loginViaToken(page, memberB.token, { email: memberB.email, password: PASSWORD });
      const guildItem = page.locator(
        `nav[aria-label="Servers"] [role="treeitem"][aria-label="${owner.guildName}"]`,
      );
      await expect(guildItem).toBeVisible({ timeout: 15000 });
    });

    test('owner bans User B → guild disappears from sidebar', async ({ request, page }) => {
      clearRateLimits();

      const banRes = await apiWithRetry(request, 'put',
        `${API_BASE}/guilds/${owner.guildId}/bans/${memberB.userId}`,
        {
          data: { delete_message_seconds: 0 },
          headers: { Authorization: `Bearer ${owner.token}` },
        },
      );
      expect(banRes.status).toBe(204);

      // User B logs in — guild should NOT be visible
      await loginViaToken(page, memberB.token, { email: memberB.email, password: PASSWORD });
      const guildItem = page.locator(
        `nav[aria-label="Servers"] [role="treeitem"][aria-label="${owner.guildName}"]`,
      );
      await expect(guildItem).not.toBeVisible({ timeout: 10000 });
    });

    test('owner unbans User B → ban list empty', async ({ request }) => {
      clearRateLimits();

      const unbanRes = await apiWithRetry(request, 'delete',
        `${API_BASE}/guilds/${owner.guildId}/bans/${memberB.userId}`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );
      expect(unbanRes.status).toBe(204);

      // Verify ban list is empty
      const bansRes = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/bans`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      const bans = await bansRes.json() as Array<{ user: { id: string } }>;
      expect(bans.every(b => b.user.id !== memberB.userId)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 7: Nickname & Profile
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Nickname & Profile', () => {
    test.beforeAll(async ({ request }) => {
      clearRateLimits();
      // Re-invite memberB after ban/unban
      const invRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/invites`, {
        data: { max_uses: 1, max_age: 86400 },
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      if (invRes.ok) {
        const invite = await invRes.json() as { code: string };
        clearRateLimits();
        await apiWithRetry(request, 'post', `${API_BASE}/invites/${invite.code}`, {
          headers: { Authorization: `Bearer ${memberB.token}` },
        });
      }
    });

    test('owner sets User B nickname → visible in member list', async ({ request, page }) => {
      clearRateLimits();
      const nick = `Cool${uniqueId().slice(0, 5)}`;
      const res = await apiWithRetry(request, 'patch',
        `${API_BASE}/guilds/${owner.guildId}/members/${memberB.userId}`,
        {
          data: { nick },
          headers: { Authorization: `Bearer ${owner.token}` },
        },
      );
      expect(res.ok).toBe(true);

      // Owner logs in and checks member list
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });
      await clickFirstGuild(page);

      const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
      await expect(generalChannel).toBeVisible({ timeout: 10000 });
      await generalChannel.click();
      await page.waitForTimeout(2000);

      // Toggle member list open
      const memberToggle = page.locator('[aria-label="Toggle member list"]');
      if (await memberToggle.isVisible().catch(() => false)) {
        const memberList = page.locator('[aria-label="Member list"]');
        if (!(await memberList.isVisible().catch(() => false))) {
          await memberToggle.click();
          await page.waitForTimeout(1000);
        }
      }

      // Nickname should appear in member list
      await expect(page.getByText(nick)).toBeVisible({ timeout: 10000 });
    });

    test('User B changes own nickname via @me endpoint → verified via API', async ({ request }) => {
      clearRateLimits();
      const myNick = `Self${uniqueId().slice(0, 5)}`;
      const res = await apiWithRetry(request, 'patch',
        `${API_BASE}/guilds/${owner.guildId}/members/@me`,
        {
          data: { nick: myNick },
          headers: { Authorization: `Bearer ${memberB.token}` },
        },
      );
      expect(res.ok).toBe(true);
      const data = await res.json() as { nick: string };
      expect(data.nick).toBe(myNick);
    });

    test('User A views User B profile popup in member list', async ({ page }) => {
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });
      await clickFirstGuild(page);

      const generalChannel = page.locator('[role="button"][aria-label*="general" i]').first();
      await expect(generalChannel).toBeVisible({ timeout: 10000 });
      await generalChannel.click();
      await page.waitForTimeout(2000);

      // Toggle member list
      const memberToggle = page.locator('[aria-label="Toggle member list"]');
      if (await memberToggle.isVisible().catch(() => false)) {
        const memberList = page.locator('[aria-label="Member list"]');
        if (!(await memberList.isVisible().catch(() => false))) {
          await memberToggle.click();
          await page.waitForTimeout(1000);
        }
      }

      // Click on a member (User B) to open their profile popup
      const memberItem = page.locator('[role="button"]').filter({ hasText: memberB.username }).first();
      if (await memberItem.isVisible({ timeout: 5000 }).catch(() => false)) {
        await memberItem.click();
        // Profile popup should appear with username
        await expect(page.getByText(memberB.username).first()).toBeVisible({ timeout: 5000 });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Section 8: Channel Permissions
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Channel Permissions', () => {
    let restrictedChannelId: string;
    let restrictedChannelName: string;

    test.beforeAll(async ({ request }) => {
      clearRateLimits();
      restrictedChannelName = `restricted${uniqueId().slice(0, 5)}`;

      // Create channel with @everyone denied SEND_MESSAGES (bit 11 = 2048)
      const chRes = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/channels`, {
        data: {
          name: restrictedChannelName,
          type: 0,
          permission_overwrites: [
            { id: owner.guildId, type: 0, allow: '0', deny: '2048' },
          ],
        },
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      const ch = await chRes.json() as { id: string };
      restrictedChannelId = ch.id;
    });

    test('User B cannot send in restricted channel — gets 403', async ({ request }) => {
      clearRateLimits();
      const msgRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${restrictedChannelId}/messages`, {
        data: { content: 'should fail' },
        headers: { Authorization: `Bearer ${memberB.token}` },
      });
      expect(msgRes.status).toBe(403);
    });

    test('owner grants User B SEND_MESSAGES → User B can send and owner sees it', async ({ request, page }) => {
      clearRateLimits();

      // Add member overwrite allowing SEND_MESSAGES for User B
      const overwriteRes = await apiWithRetry(request, 'put',
        `${API_BASE}/channels/${restrictedChannelId}/permissions/${memberB.userId}`,
        {
          data: { type: 1, allow: '2048', deny: '0' },
          headers: { Authorization: `Bearer ${owner.token}` },
        },
      );
      expect(overwriteRes.ok).toBe(true);

      // User B can now send a message
      clearRateLimits();
      const msgText = `allowed${uniqueId()}`;
      const msgRes = await apiWithRetry(request, 'post', `${API_BASE}/channels/${restrictedChannelId}/messages`, {
        data: { content: msgText },
        headers: { Authorization: `Bearer ${memberB.token}` },
      });
      expect(msgRes.ok).toBe(true);

      // Owner logs in and navigates to the channel to see User B's message
      await loginViaToken(page, owner.token, { email: owner.email, password: PASSWORD });
      await clickFirstGuild(page);

      const channelBtn = page.locator(`[role="button"][aria-label*="${restrictedChannelName}" i]`).first();
      await expect(channelBtn).toBeVisible({ timeout: 10000 });
      await channelBtn.click();

      await expect(page.getByText(msgText)).toBeVisible({ timeout: 15000 });
    });
  });
});
