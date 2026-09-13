import * as mediasoup from 'mediasoup';
import os from 'os';

// ── Worker creation ──────────────────────────────────────────────────

const numWorkers = Math.max(1, os.cpus().length);

export async function createWorkers(): Promise<mediasoup.types.Worker[]> {
  const workers: mediasoup.types.Worker[] = [];

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT || '10000', 10),
      rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT || '59999', 10),
    });

    worker.on('died', () => {
      console.error(`mediasoup Worker pid=${worker.pid} died — exiting in 2 s`);
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
  }

  return workers;
}

// ── Router media codecs ──────────────────────────────────────────────

// preferredPayloadType is required by mediasoup's RtpCodecCapability type, but the values
// must be chosen carefully: when mediasoup builds the router's RTP capabilities it also
// generates an RTX (retransmission) codec for every VIDEO codec, drawing its payload type
// from the same 96–127 dynamic pool immediately after that codec. Pinning the media codecs
// to consecutive 100/101/102 made VP8's auto-generated RTX claim 102 — colliding with H264
// and throwing "duplicated codec.preferredPayloadType" on EVERY router creation (so every
// voice join failed). We therefore leave a gap after each video codec (…102, …104) so its
// RTX slots into the number below it (101, 103) with no collision. Audio (opus) has no RTX.
export const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 100,
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
      usedtx: 1,
    },
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    preferredPayloadType: 102,
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    preferredPayloadType: 104,
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

// ── Announced-IP auto-detection ──────────────────────────────────────

/**
 * Build the list of WebRTC listen IPs.
 *
 * Announce a concrete, routable ICE candidate for EVERY address a client might
 * use to reach this server, and let the client's ICE agent pick whichever one is
 * actually reachable. This makes voice work across every topology without hand-
 * tuning: a device on the LAN, a browser on the same host, and a headless browser
 * in the same Docker network each find a candidate that connects.
 *
 * Candidates are announced in this order (deduplicated):
 *  1. `ANNOUNCED_IP`, if set — your LAN or public IP for other devices / the internet.
 *  2. Every non-internal IPv4 the host currently has — this covers the container's
 *     own network IP (so in-Docker clients connect) and the LAN address on bare metal.
 *  3. `127.0.0.1` (loopback), kept LAST — so a browser on the SAME machine
 *     (e.g. `https://localhost:5173`) always has a working candidate, even on
 *     Docker Desktop where the container can't see the host's real LAN IP.
 *
 * Because every candidate is offered, `ANNOUNCED_IP` is now optional for same-host
 * use; set it only to reach the server from OTHER devices (its LAN or public IP).
 *
 * `MEDIASOUP_LISTEN_IP` (default 0.0.0.0) still controls the bind address.
 */
export function detectAnnouncedIps(): mediasoup.types.TransportListenIp[] {
  const listenIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
  const entries: mediasoup.types.TransportListenIp[] = [];
  const seen = new Set<string>();
  const add = (bind: string, announcedIp: string) => {
    if (seen.has(announcedIp)) return;
    seen.add(announcedIp);
    entries.push({ ip: bind, announcedIp });
  };

  // Explicit override: when ANNOUNCED_IP is set, announce ONLY it — a single clean, routable
  // candidate. This is the behaviour that originally worked. Advertising the container's
  // Docker-internal IP (172.x, which no real browser can reach) and loopback ALONGSIDE it hands
  // a full-ICE client dead candidate pairs to keep probing; over a cross-machine link that churn
  // drifts the selected pair / loses ICE consent and ALL media (audio, camera, screen) goes
  // black after ~tens of seconds. Only auto-detect host addresses when no override is given.
  const override = process.env.ANNOUNCED_IP?.trim();
  if (override) {
    return [{ ip: listenIp, announcedIp: override }];
  }

  // No override: announce every non-internal IPv4 host address (container IP, LAN, ...) plus
  // loopback, so same-host, LAN, and in-Docker clients each find a reachable candidate.
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      // Node <18 reports family as the number 4; ≥18 reports the string 'IPv4'.
      const isIPv4 = addr.family === 'IPv4' || (addr.family as unknown) === 4;
      if (isIPv4 && !addr.internal) add(listenIp, addr.address);
    }
  }

  // 3. Loopback last — always a candidate for same-host clients.
  add('127.0.0.1', '127.0.0.1');

  return entries;
}

// ── WebRtcTransport options ──────────────────────────────────────────

export const webRtcTransportOptions: mediasoup.types.WebRtcTransportOptions = {
  listenIps: detectAnnouncedIps(),
  // Start the server->consumer bandwidth estimate high so a watcher gets a sharp stream
  // immediately on a LAN instead of ramping up from a low default (which reads as poor,
  // laggy video for the first seconds). The real ceiling is still governed by BWE.
  initialAvailableOutgoingBitrate: 10_000_000,
  // (Incoming bitrate is capped per-transport with transport.setMaxIncomingBitrate()
  // after creation -- it is not a WebRtcTransport option, so it does not belong here.)
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
};

// ── Producer presets (informational — clients may override) ──────────

export const audioProducerOptions = {
  codecOptions: {
    opusStereo: true,
    opusFec: true,
    opusDtx: true,
    opusMaxPlaybackRate: 48000,
  },
};

export const webcamProducerOptions = {
  encodings: [
    { maxBitrate: 500_000, scaleResolutionDownBy: 4 },
    { maxBitrate: 1_500_000, scaleResolutionDownBy: 2 },
    { maxBitrate: 5_000_000, scaleResolutionDownBy: 1 },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

export const screenShareProducerOptions = {
  // 10 Mbps single layer — enough headroom for 1080p60 / 4K30 screen share.
  encodings: [{ maxBitrate: 10_000_000 }],
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};
