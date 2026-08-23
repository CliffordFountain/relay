import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import {
  registerUserWithVoice,
  addMemberToGuild,
  loginViaToken,
  clickFirstGuild,
} from './helpers';

/**
 * End-to-end proof that REAL media flows between two browsers through the mediasoup
 * SFU — the media plane that was previously unimplemented on the client.
 *
 * Scenario (mirrors the reported bug): Alice joins a voice channel and turns her
 * camera + mic on (produces). Bob joins AFTER she's already live and must both SEE
 * decoded video frames (videoWidth > 0 proves RTP arrived and decoded) and receive a
 * live remote audio track. Camera/mic exercise the identical produce→consume path as
 * screen-share, so this proves the whole pipeline.
 *
 * Runs with Chromium fake-media flags so getUserMedia yields a synthetic, encodable
 * camera + mic with no permission prompt. Requires the stack to be up (HTTPS on 5173).
 *
 * NOTE for in-container runs: the browser must be able to reach the voice-server's
 * mediasoup announced IP:UDP ports. When Playwright runs INSIDE the client container,
 * start the voice-server with ANNOUNCED_IP unset (it auto-announces its 172.x container
 * IP, reachable on the docker network):  ANNOUNCED_IP="" docker compose up -d voice-server
 * On a real LAN, ANNOUNCED_IP is the host LAN IP and browsers reach it via the published
 * 40000-40100/udp ports — no change needed there.
 */

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

// Browser-level flags: synthetic camera/mic, auto-granted permissions, autoplay on.
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      // Let getDisplayMedia (screen share) resolve headlessly to a synthetic source.
      '--auto-select-desktop-capture-source=Entire screen',
      '--auto-accept-this-tab-capture',
    ],
  },
});

async function joinVoiceChannel(page: Page): Promise<Locator> {
  await clickFirstGuild(page);
  const voiceChannel = page.locator('[role="button"][aria-label="Voice channel voice-test"]');
  await expect(voiceChannel).toBeVisible({ timeout: 20000 });
  await voiceChannel.click();
  // The full voice view is up once its control toolbar renders (scoped to avoid the
  // separate mini-controls in the sidebar's voice-connected bar).
  const toolbar = page.getByRole('toolbar', { name: 'Voice controls' });
  await expect(toolbar).toBeVisible({ timeout: 20000 });
  return toolbar;
}

test.describe('SFU media flow (2 browsers)', () => {
  test('a late-joiner sees the streamer\'s video frames and receives their audio', async ({ browser, request }) => {
    test.setTimeout(180000);

    // ── Fixtures: Alice owns a guild + voice channel; Bob is a member. ──
    const alice = await registerUserWithVoice(request, 'sfua');
    const bob = await addMemberToGuild(request, alice.token, alice.guildId, 'sfub');

    let aliceCtx: BrowserContext | undefined;
    let bobCtx: BrowserContext | undefined;
    try {
      aliceCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
      bobCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
      const alicePage = await aliceCtx.newPage();
      const bobPage = await bobCtx.newPage();

      // ── Alice joins voice and goes live (camera + mic) ──
      await loginViaToken(alicePage, alice.token, { email: alice.email, password: 'TestPass123A' });
      const aliceControls = await joinVoiceChannel(alicePage);

      // Camera on -> produces a video track to the SFU.
      await aliceControls.getByLabel('Turn On Camera').click();
      // Alice's own self-preview should light up (confirms capture + local render).
      await expect
        .poll(
          () => alicePage.evaluate(() =>
            Array.from(document.querySelectorAll('video')).some(v => v.videoWidth > 0),
          ),
          { timeout: 20000, message: 'Alice local camera preview never produced frames' },
        )
        .toBe(true);

      // NOTE: no mute-toggle needed — the mic auto-starts on join (VoiceConnectedBar),
      // so Alice is already producing audio. The audio assertion below only passes if
      // that auto-capture + produce actually works.

      // ── Bob joins AFTER Alice is already streaming ──
      await loginViaToken(bobPage, bob.token, { email: bob.email, password: 'TestPass123A' });
      await joinVoiceChannel(bobPage);

      // PRIMARY PROOF: Bob decodes Alice's camera video (frames => RTP really flowed
      // Alice -> SFU -> Bob). Bob is not sharing, so any video with size is remote.
      await expect
        .poll(
          () => bobPage.evaluate(() =>
            Array.from(document.querySelectorAll('video')).some(v => v.videoWidth > 0 && v.readyState >= 2),
          ),
          { timeout: 45000, message: 'Bob never received decoded remote video frames' },
        )
        .toBe(true);

      // AUDIO PROOF (step 1): Bob has a live remote audio track attached to an <audio> sink.
      await expect
        .poll(
          () => bobPage.evaluate(() =>
            Array.from(document.querySelectorAll('audio')).some(a => {
              const s = a.srcObject as MediaStream | null;
              const tracks = s?.getAudioTracks?.() ?? [];
              return tracks.length > 0 && tracks[0]!.readyState === 'live';
            }),
          ),
          { timeout: 45000, message: 'Bob never received a live remote audio track' },
        )
        .toBe(true);

      // AUDIO PROOF (step 2): a track can read 'live' while completely SILENT (RTP not
      // flowing / mic track disabled). Tap the remote stream with a WebAudio analyser and
      // require real signal energy — Chromium's fake mic emits a tone, so measurable energy
      // proves audio is actually decoding through the SFU, not just that a track object exists.
      const audioEnergy = await bobPage.evaluate(async () => {
        const el = Array.from(document.querySelectorAll('audio')).find(a => {
          const s = a.srcObject as MediaStream | null;
          const t = s?.getAudioTracks?.() ?? [];
          return t.length > 0 && t[0]!.readyState === 'live';
        }) as HTMLAudioElement | undefined;
        if (!el || !el.srcObject) return -1;
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AC();
        try { await ctx.resume(); } catch { /* ignore */ }
        const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let peak = 0;
        const start = Date.now();
        while (Date.now() - start < 4000) {
          analyser.getByteTimeDomainData(buf);
          for (let i = 0; i < buf.length; i++) {
            const dev = Math.abs(buf[i]! - 128);
            if (dev > peak) peak = dev;
          }
          if (peak > 8) break; // clear signal found early
          await new Promise(r => setTimeout(r, 100));
        }
        try { await ctx.close(); } catch { /* ignore */ }
        return peak;
      });
      expect(
        audioEnergy,
        'Bob has a live audio track but received NO decoded audio energy (silent stream — outgoing voice not actually flowing)',
      ).toBeGreaterThan(8);

      // The decoded remote video must be rendered inside Alice's tile on Bob's page
      // (i.e. it's her consumed camera, not a stray element). Her tile is aria-labelled
      // with her username.
      const aliceTile = bobPage.locator(`[aria-label*="${alice.username}"]`).first();
      await expect(aliceTile).toBeVisible({ timeout: 10000 });
      await expect
        .poll(
          () => aliceTile.evaluate((el) => {
            const v = el.querySelector('video');
            return Boolean(v && (v as HTMLVideoElement).videoWidth > 0);
          }),
          { timeout: 15000, message: "Alice's tile did not render her remote camera video" },
        )
        .toBe(true);
    } finally {
      await aliceCtx?.close();
      await bobCtx?.close();
    }
  });

  test('a watcher sees a remote SCREEN share on the stage, with fullscreen + mute controls', async ({ browser, request }) => {
    test.setTimeout(180000);
    // Regression guard for the media-type bug: a screen share was consumed with empty
    // appData and misclassified as a camera, so it rendered as a grid tile instead of
    // the stage — leaving the watcher with no fullscreen/mute controls. It must land on
    // the stage (data-testid="stream-stage") with those controls.
    const alice = await registerUserWithVoice(request, 'sfsa');
    const bob = await addMemberToGuild(request, alice.token, alice.guildId, 'sfsb');

    let aliceCtx: BrowserContext | undefined;
    let bobCtx: BrowserContext | undefined;
    try {
      aliceCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
      bobCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
      const alicePage = await aliceCtx.newPage();
      const bobPage = await bobCtx.newPage();

      // Alice joins and goes live via screen share (Go Live modal -> getDisplayMedia).
      await loginViaToken(alicePage, alice.token, { email: alice.email, password: 'TestPass123A' });
      const aliceControls = await joinVoiceChannel(alicePage);
      await aliceControls.getByLabel('Share Your Screen').click();
      await alicePage.getByRole('button', { name: 'Go Live' }).click();
      // Screen capture goes through the Go Live modal + getDisplayMedia, which is slower
      // than a plain camera toggle — give it room.
      await expect(alicePage.getByTestId('stream-stage')).toBeVisible({ timeout: 40000 });

      // Bob joins AFTER and must get the screen on the STAGE (not a tile).
      await loginViaToken(bobPage, bob.token, { email: bob.email, password: 'TestPass123A' });
      await joinVoiceChannel(bobPage);

      const stage = bobPage.getByTestId('stream-stage');
      await expect(stage).toBeVisible({ timeout: 30000 });
      await expect
        .poll(
          () => stage.evaluate((el) => {
            const v = el.querySelector('video');
            return Boolean(v && (v as HTMLVideoElement).videoWidth > 0);
          }),
          { timeout: 30000, message: "Watcher's stage did not render the remote screen share" },
        )
        .toBe(true);

      // The controls that were missing for watchers must be present on the stage.
      await expect(stage.getByRole('button', { name: 'Enter Fullscreen' })).toBeVisible();
      await expect(stage.getByRole('button', { name: 'Mute stream' })).toBeVisible();
    } finally {
      await aliceCtx?.close();
      await bobCtx?.close();
    }
  });
});
