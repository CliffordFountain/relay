import { test, expect } from '@playwright/test';
import {
  clearRateLimits,
  registerUserWithVoice,
  loginViaToken,
  clickFirstGuild,
  type VoiceFixture,
} from './helpers';

/**
 * Voice E2E Tests
 *
 * Tests voice channel UI interactions. These validate the UI behavior
 * without requiring actual WebRTC (headless Chromium has no real audio/video devices).
 * Tests verify that the voice UI components render correctly.
 */

const PASSWORD = 'TestPass123A';

test.describe('Voice', () => {
  let fixture: VoiceFixture;

  test.beforeAll(async ({ request }) => {
    clearRateLimits();
    fixture = await registerUserWithVoice(request);
  });

  async function navigateToVoiceChannel(page: import('@playwright/test').Page) {
    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });
    await clickFirstGuild(page);
    // Voice channel button has aria-label containing "voice-test"
    await expect(page.locator('[role="button"][aria-label*="voice-test" i]')).toBeVisible({ timeout: 10000 });
  }

  // Test 1: Click voice channel -> VoiceChannelView or VoiceConnectedBar appears
  test('click voice channel -> voice channel view appears', async ({ page }) => {
    await navigateToVoiceChannel(page);

    // Click the voice channel
    await page.locator('[role="button"][aria-label*="voice-test" i]').click();

    // VoiceChannelView renders with the channel name in the header
    // headerName class contains the channel name text
    const voiceHeader = page.locator('[class*="headerName"]').filter({ hasText: 'voice-test' });

    // Or the VoiceConnectedBar with aria-label="Voice Connected"
    const connectedBar = page.locator('[aria-label="Voice Connected"]');

    // Or the empty state message when no one else is in the channel
    const emptyState = page.getByText(/no one is currently in this voice channel/i);

    // At least one of these must be visible
    const voiceHeaderVisible = await voiceHeader.isVisible({ timeout: 10000 }).catch(() => false);
    const connectedBarVisible = await connectedBar.isVisible({ timeout: 3000 }).catch(() => false);
    const emptyStateVisible = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);

    expect(voiceHeaderVisible || connectedBarVisible || emptyStateVisible).toBe(true);
  });

  // Test 2: Voice connected bar shows controls
  test('after joining voice, VoiceConnectedBar shows Voice Connected text, Camera, Screen Share, and Disconnect', async ({ page }) => {
    await navigateToVoiceChannel(page);
    await page.locator('[role="button"][aria-label*="voice-test" i]').click();

    // VoiceConnectedBar renders with aria-label="Voice Connected"
    const connectedBar = page.locator('[aria-label="Voice Connected"]');
    await expect(connectedBar).toBeVisible({ timeout: 10000 });

    // "Voice Connected" status text
    await expect(connectedBar.getByText('Voice Connected')).toBeVisible();

    // Camera button (aria-label "Turn On Camera" or "Turn Off Camera")
    const cameraBtn = connectedBar.locator('[aria-label="Turn On Camera"], [aria-label="Turn Off Camera"]');
    await expect(cameraBtn).toBeVisible();

    // Screen Share button (aria-label "Share Your Screen" or "Stop Sharing")
    const screenShareBtn = connectedBar.locator('[aria-label="Share Your Screen"], [aria-label="Stop Sharing"]');
    await expect(screenShareBtn).toBeVisible();

    // Disconnect button
    const disconnectBtn = connectedBar.locator('[aria-label="Disconnect"]');
    await expect(disconnectBtn).toBeVisible();
  });

  // Test 3: Mute/Deafen buttons in user panel toggle
  test('mute and deafen buttons in user panel toggle on click', async ({ page }) => {
    await navigateToVoiceChannel(page);

    // Mute button in user status panel (always present, not just when in voice)
    const userPanel = page.locator('[aria-label="User status and settings"]');
    await expect(userPanel).toBeVisible({ timeout: 10000 });

    // Mute switch starts unchecked (not muted)
    const muteBtn = userPanel.locator('[aria-label="Mute"]');
    await expect(muteBtn).toBeVisible({ timeout: 5000 });
    await expect(muteBtn).toHaveAttribute('aria-checked', 'false');

    // Click to mute
    await muteBtn.click();

    // Should now be checked (muted)
    await expect(muteBtn).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });

    // Deafen switch should also be present
    const deafenBtn = userPanel.locator('[aria-label="Deafen"]');
    await expect(deafenBtn).toBeVisible();

    // Click again to unmute
    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-checked', 'false', { timeout: 5000 });
  });

  // Test 4: Go Live modal opens with resolution and frame rate dropdowns
  test('screen share button opens Go Live modal with resolution and frame rate', async ({ page }) => {
    await navigateToVoiceChannel(page);
    await page.locator('[role="button"][aria-label*="voice-test" i]').click();

    // Wait for connected bar to appear
    const connectedBar = page.locator('[aria-label="Voice Connected"]');
    await expect(connectedBar).toBeVisible({ timeout: 10000 });

    // Click "Share Your Screen" button in the connected bar
    const screenShareBtn = connectedBar.locator('[aria-label="Share Your Screen"]');
    await expect(screenShareBtn).toBeVisible({ timeout: 5000 });
    await screenShareBtn.click();

    // GoLiveModal opens as role="dialog" aria-label="Screen Share"
    const goLiveModal = page.locator('[role="dialog"][aria-label="Screen Share"]');
    await expect(goLiveModal).toBeVisible({ timeout: 5000 });

    // Resolution dropdown (select#go-live-resolution)
    const resolutionSelect = goLiveModal.locator('#go-live-resolution');
    await expect(resolutionSelect).toBeVisible();

    // Frame Rate dropdown (select#go-live-framerate)
    const frameRateSelect = goLiveModal.locator('#go-live-framerate');
    await expect(frameRateSelect).toBeVisible();

    // Cancel button should close the modal
    const cancelBtn = goLiveModal.getByRole('button', { name: 'Cancel' });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(goLiveModal).not.toBeVisible({ timeout: 5000 });
  });

  // Test 5: Disconnect removes VoiceConnectedBar
  test('disconnect button hides VoiceConnectedBar', async ({ page }) => {
    await navigateToVoiceChannel(page);
    await page.locator('[role="button"][aria-label*="voice-test" i]').click();

    // Wait for connected bar
    const connectedBar = page.locator('[aria-label="Voice Connected"]');
    await expect(connectedBar).toBeVisible({ timeout: 10000 });

    // Click Disconnect
    const disconnectBtn = connectedBar.locator('[aria-label="Disconnect"]');
    await expect(disconnectBtn).toBeVisible();
    await disconnectBtn.click();

    // VoiceConnectedBar should disappear
    await expect(connectedBar).not.toBeVisible({ timeout: 5000 });

    // User should still see the server sidebar (not kicked from app)
    await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible();
  });
});
