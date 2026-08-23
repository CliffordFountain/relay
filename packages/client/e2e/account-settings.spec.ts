import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, sendMessageViaAPI, registerUser, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe('Read-state, notification settings, MFA', () => {
  test('acking a message records read-state', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'rs');
    const msg = await sendMessageViaAPI(request, owner.token, owner.channelId, 'read me');

    const ack = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages/${msg.id}/ack`, { headers: auth(owner.token) });
    expect(ack.status).toBe(204);

    const rs = await apiWithRetry(request, 'get', `${API_BASE}/users/@me/read-states`, { headers: auth(owner.token) });
    expect(rs.status).toBe(200);
    const states = await rs.json() as Array<{ channel_id: string; last_message_id: string }>;
    const st = states.find(s => s.channel_id === owner.channelId);
    expect(st?.last_message_id).toBe(msg.id);
  });

  test('guild notification settings get/patch and persist; outsider denied', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'ns');
    const outsider = await registerUser(request, 'nsout');
    const base = `${API_BASE}/users/@me/guilds/${owner.guildId}/notification-settings`;

    expect((await apiWithRetry(request, 'get', base, { headers: auth(owner.token) })).status).toBe(200);
    const patch = await apiWithRetry(request, 'patch', base, {
      data: { muted: true, message_notifications: 1, suppress_everyone: true }, headers: auth(owner.token),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ muted: true, message_notifications: 1, suppress_everyone: true });
    // Persisted.
    expect(await (await apiWithRetry(request, 'get', base, { headers: auth(owner.token) })).json()).toMatchObject({ muted: true });
    // Outsider (not a guild member) denied.
    expect((await apiWithRetry(request, 'get', base, { headers: auth(outsider.token) })).status).toBe(403);
  });

  test('MFA TOTP enable returns a secret + provisioning URI; a wrong code is rejected', async ({ request }) => {
    const user = await registerUser(request, 'mfa');
    const enable = await apiWithRetry(request, 'post', `${API_BASE}/users/@me/mfa/totp/enable`, { headers: auth(user.token) });
    expect(enable.status).toBe(200);
    const { secret, provisioning_uri } = await enable.json() as { secret: string; provisioning_uri: string };
    expect(secret).toBeTruthy();
    expect(provisioning_uri).toContain('otpauth://totp/');

    const bad = await apiWithRetry(request, 'post', `${API_BASE}/users/@me/mfa/totp/verify`, {
      data: { secret, code: '000000' }, headers: auth(user.token),
    });
    expect(bad.status).toBe(400);
  });
});
