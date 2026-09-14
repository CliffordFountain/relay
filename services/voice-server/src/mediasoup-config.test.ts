import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';

import { detectAnnouncedIps } from './mediasoup-config.js';

// Build a minimal, well-typed os.NetworkInterfaceInfo for tests.
function ipv4(address: string, internal: boolean): os.NetworkInterfaceInfoIPv4 {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

function ipv6(address: string, internal: boolean): os.NetworkInterfaceInfoIPv6 {
  return {
    address,
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/64`,
    scopeid: 0,
  };
}

function mockInterfaces(value: NodeJS.Dict<os.NetworkInterfaceInfo[]>) {
  vi.spyOn(os, 'networkInterfaces').mockReturnValue(value);
}

describe('detectAnnouncedIps', () => {
  const savedAnnounced = process.env.ANNOUNCED_IP;
  const savedListen = process.env.MEDIASOUP_LISTEN_IP;

  beforeEach(() => {
    delete process.env.ANNOUNCED_IP;
    delete process.env.MEDIASOUP_LISTEN_IP;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedAnnounced === undefined) delete process.env.ANNOUNCED_IP;
    else process.env.ANNOUNCED_IP = savedAnnounced;
    if (savedListen === undefined) delete process.env.MEDIASOUP_LISTEN_IP;
    else process.env.MEDIASOUP_LISTEN_IP = savedListen;
  });

  it('announces the detected LAN IP and appends loopback last', () => {
    mockInterfaces({
      lo: [ipv4('127.0.0.1', true)],
      eth0: [ipv4('192.168.1.50', false)],
    });

    const result = detectAnnouncedIps();

    // One detected LAN entry + one loopback entry.
    expect(result).toHaveLength(2);
    // Detected entry binds on all interfaces and announces the routable IP.
    expect(result[0]).toEqual({ ip: '0.0.0.0', announcedIp: '192.168.1.50' });
    // Loopback is always the LAST entry.
    expect(result[result.length - 1]).toEqual({
      ip: '127.0.0.1',
      announcedIp: '127.0.0.1',
    });
  });

  it('emits one entry per non-internal IPv4, loopback still last', () => {
    mockInterfaces({
      lo: [ipv4('127.0.0.1', true)],
      eth0: [ipv4('192.168.1.50', false)],
      wlan0: [ipv4('10.0.0.7', false)],
    });

    const result = detectAnnouncedIps();

    const announced = result.map((e) => e.announcedIp);
    expect(announced).toEqual(['192.168.1.50', '10.0.0.7', '127.0.0.1']);
    // Every entry binds on 0.0.0.0 except the loopback tail.
    const binds = result.map((e) => e.ip);
    expect(binds).toEqual(['0.0.0.0', '0.0.0.0', '127.0.0.1']);
  });

  it('ignores internal and IPv6 addresses', () => {
    mockInterfaces({
      lo: [ipv4('127.0.0.1', true), ipv6('::1', true)],
      eth0: [ipv4('192.168.1.50', false), ipv6('fe80::1', false)],
    });

    const result = detectAnnouncedIps();

    expect(result).toEqual([
      { ip: '0.0.0.0', announcedIp: '192.168.1.50' },
      { ip: '127.0.0.1', announcedIp: '127.0.0.1' },
    ]);
  });

  it('announces ONLY the explicit ANNOUNCED_IP override (a single clean candidate)', () => {
    process.env.ANNOUNCED_IP = '203.0.113.9';
    mockInterfaces({
      lo: [ipv4('127.0.0.1', true)],
      eth0: [ipv4('192.168.1.50', false)],
    });

    const result = detectAnnouncedIps();

    // When an override is set we advertise exactly that one routable candidate. Adding the
    // container IP + loopback alongside it handed full-ICE clients dead pairs to keep
    // probing, which over a cross-machine link drifts the selected pair / loses ICE consent,
    // so ALL media goes black after ~tens of seconds. One clean candidate avoids that.
    expect(result.map((e) => e.announcedIp)).toEqual(['203.0.113.9']);
    expect(result[0]).toEqual({ ip: '0.0.0.0', announcedIp: '203.0.113.9' });
  });

  it('returns just the override even when it equals a detected IP', () => {
    process.env.ANNOUNCED_IP = '192.168.1.50';
    mockInterfaces({
      lo: [ipv4('127.0.0.1', true)],
      eth0: [ipv4('192.168.1.50', false)],
    });

    const result = detectAnnouncedIps();

    expect(result.map((e) => e.announcedIp)).toEqual(['192.168.1.50']);
  });

  it('falls back to loopback only when no non-internal IPv4 exists', () => {
    mockInterfaces({
      lo: [ipv4('127.0.0.1', true)],
    });

    const result = detectAnnouncedIps();

    expect(result).toEqual([{ ip: '127.0.0.1', announcedIp: '127.0.0.1' }]);
  });

  it('respects MEDIASOUP_LISTEN_IP for the bind address', () => {
    process.env.MEDIASOUP_LISTEN_IP = '0.0.0.0';
    mockInterfaces({
      eth0: [ipv4('192.168.1.50', false)],
    });

    const result = detectAnnouncedIps();

    expect(result[0]).toEqual({ ip: '0.0.0.0', announcedIp: '192.168.1.50' });
  });
});
