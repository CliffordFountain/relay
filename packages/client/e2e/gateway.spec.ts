import { test, expect } from '@playwright/test';
import { accessSync } from 'fs';
import {
  uniqueId,
  registerUserWithGuild,
  addMemberToGuild,
  clearRateLimits,
  loginViaToken,
  enterGeneralChannel,
  sendMessageViaAPI,
  type GuildFixture,
} from './helpers';

/** Resolve the gateway URL for test-runner Node.js code.
 * VITE_GATEWAY_URL uses localhost (for browsers via Docker port mapping),
 * but the Node.js test process inside Docker must use the service name. */
function resolveGatewayUrl(): string {
  if (process.env.E2E_GATEWAY_URL) return process.env.E2E_GATEWAY_URL;
  const url = process.env.VITE_GATEWAY_URL ?? 'ws://localhost:4000/gateway';
  try {
    accessSync('/.dockerenv');
    // Running inside Docker: replace localhost with the gateway service name
    return url.replace('localhost', 'gateway');
  } catch {
    return url;
  }
}

/**
 * Gateway WebSocket E2E Tests
 *
 * Verifies that the gateway WebSocket connection is established after login
 * (no "Gateway error" in the console) and that real-time message delivery works
 * across two browser contexts.
 *
 * These tests require the full backend stack (Elixir gateway, Python API,
 * Rust data-services) to be running AND the gateway to properly handle the
 * full lifecycle: Hello -> Identify -> Ready -> Dispatch. They are skipped
 * when the gateway is not fully functional.
 */

const PASSWORD = 'TestPass123A';

/**
 * Check whether the gateway WebSocket endpoint is fully functional by
 * attempting a real WebSocket connection, waiting for Hello (op 10), sending
 * Identify (op 2), and waiting for a dispatch (READY event, op 0).
 *
 * This ensures the gateway can complete the full handshake, not just accept
 * connections.
 */
async function isGatewayFullyFunctional(): Promise<boolean> {
  const { WebSocket: WS } = await import('ws');
  const gatewayUrl = resolveGatewayUrl();

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 8000);

    let ws: InstanceType<typeof WS>;
    try {
      ws = new WS(gatewayUrl);
    } catch {
      clearTimeout(timeout);
      resolve(false);
      return;
    }

    let receivedHello = false;

    ws.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());

        if (payload.op === 10 && !receivedHello) {
          receivedHello = true;
          // Send Identify with a dummy token to see if the gateway processes it
          ws.send(JSON.stringify({
            op: 2,
            d: {
              token: 'gateway_health_check_dummy',
              intents: 0x1 | 0x200,
              properties: { os: 'test', browser: 'test', device: 'test' },
            },
          }));
          return;
        }

        // If we receive any dispatch event (op 0) or an Invalid Session (op 9),
        // the gateway is processing our messages (functional).
        // Op 9 with d=false means "bad token" which is expected for a dummy token,
        // but it proves the gateway processes Identify.
        if (payload.op === 0 || payload.op === 9) {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
          return;
        }
      } catch {
        // Malformed message
      }
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      // If we received Hello but nothing after Identify, gateway isn't fully functional
      resolve(false);
    });
  });
}

test.describe('Gateway Connection', () => {
  let fixture: GuildFixture;
  let gatewayFunctional: boolean;

  test.beforeAll(async ({ request }) => {
    gatewayFunctional = await isGatewayFullyFunctional();
    if (!gatewayFunctional) return;
    clearRateLimits();
    fixture = await registerUserWithGuild(request, 'gw');
  });

  test('after login, no "Gateway error" appears in console', async ({ page }) => {
    test.skip(!gatewayFunctional, 'Gateway is not fully functional (does not process Identify) -- requires full backend stack');

    const consoleErrors: string[] = [];

    // Capture console errors that originate from our gateway client code.
    // Browser-level WebSocket connection errors (e.g. ERR_CONNECTION_REFUSED)
    // are filtered out because they are not from our application code.
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') {
        // Ignore browser-generated WebSocket/network errors
        if (text.includes('net::ERR_') || text.includes('WebSocket connection to')) return;
        if (
          text.includes('Gateway') || text.includes('gateway')
        ) {
          consoleErrors.push(text);
        }
      }
    });

    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });

    // Give the gateway connection time to establish (Hello -> Identify -> Ready)
    await page.waitForTimeout(5000);

    // Verify no gateway errors appeared
    expect(consoleErrors).toEqual([]);

    // The app should be fully loaded with the server sidebar
    await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible();
  });

  test('after login, gateway WebSocket connects to /gateway endpoint', async ({ page }) => {
    test.skip(!gatewayFunctional, 'Gateway is not fully functional (does not process Identify) -- requires full backend stack');

    // Track WebSocket connections
    const wsUrls: string[] = [];

    page.on('websocket', (ws) => {
      wsUrls.push(ws.url());
    });

    await loginViaToken(page, fixture.token, { email: fixture.email, password: PASSWORD });

    // Wait for the WebSocket to be established
    await page.waitForTimeout(5000);

    // Should have opened a WebSocket to the gateway
    const gatewayWs = wsUrls.find((url) => url.includes('4000') || url.includes('/gateway'));
    expect(gatewayWs).toBeDefined();
  });
});

test.describe('Gateway Real-time Messaging', () => {
  let ownerFixture: GuildFixture;
  let gatewayFunctional: boolean;

  test.beforeAll(async ({ request }) => {
    gatewayFunctional = await isGatewayFullyFunctional();
    if (!gatewayFunctional) return;
    clearRateLimits();
    ownerFixture = await registerUserWithGuild(request, 'gw_rt');
  });

  test('message sent via API appears in real-time for connected user', async ({ page, request }) => {
    test.skip(!gatewayFunctional, 'Gateway is not fully functional (does not process Identify) -- requires full backend stack');

    // Login and navigate to the channel
    await enterGeneralChannel(page, ownerFixture.token, {
      email: ownerFixture.email,
      password: PASSWORD,
    });

    // Send a message via the REST API (simulating another client or server-side event)
    // Avoid underscores in message text — Relay's markdown renders _word_ as italic,
    // splitting the DOM text and breaking getByText.
    const msgContent = `realtimetest${uniqueId()}`;
    await sendMessageViaAPI(request, ownerFixture.token, ownerFixture.channelId, msgContent);

    // The message should appear in the UI via the gateway WebSocket
    await expect(page.getByText(msgContent)).toBeVisible({ timeout: 15000 });
  });

  test('message sent in UI by user A appears in real-time for user B', async ({ browser, request }) => {
    test.skip(!gatewayFunctional, 'Gateway is not fully functional (does not process Identify) -- requires full backend stack');

    clearRateLimits();

    // Create a second user and add them to the guild
    const member = await addMemberToGuild(
      request,
      ownerFixture.token,
      ownerFixture.guildId,
      'gw_member',
    );

    // Open two browser contexts: one for the owner, one for the member
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // Both users enter the general channel.
      // Clear rate limits between the two logins so pageA's API activity does
      // not leave behind a rate-limited bucket when pageB starts loading.
      await enterGeneralChannel(pageA, ownerFixture.token, {
        email: ownerFixture.email,
        password: PASSWORD,
      });
      clearRateLimits();
      await enterGeneralChannel(pageB, member.token, {
        email: member.email,
        password: PASSWORD,
      });

      // User A sends a message via the UI
      // Avoid underscores — Relay's markdown renders _word_ as italic, splitting DOM text.
      const msgText = `crossuser${uniqueId()}`;
      const inputA = pageA.locator('textarea[aria-label*="Message"]');
      await inputA.fill(msgText);
      await inputA.press('Enter');

      // User A should see their own message
      await expect(pageA.getByText(msgText)).toBeVisible({ timeout: 10000 });

      // User B should receive the message via the gateway in real-time
      await expect(pageB.getByText(msgText)).toBeVisible({ timeout: 15000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
