import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, registerUser, getCurrentUserId, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe('Group DMs', () => {
  test('create a group DM with multiple recipients; all participants see + exchange messages', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'gd');
    const m1 = await addMemberToGuild(request, owner.token, owner.guildId, 'gd1');
    const m2 = await addMemberToGuild(request, owner.token, owner.guildId, 'gd2');

    const create = await apiWithRetry(request, 'post', `${API_BASE}/users/@me/channels`, {
      data: { recipients: [m1.userId, m2.userId] }, headers: auth(owner.token),
    });
    expect(create.status).toBe(200);
    const gdm = await create.json() as { id: string; type: number };
    expect(gdm.type).toBe(3);

    // All three participants see it.
    for (const t of [owner.token, m1.token, m2.token]) {
      const list = await apiWithRetry(request, 'get', `${API_BASE}/users/@me/channels`, { headers: auth(t) });
      expect(JSON.stringify(await list.json())).toContain(gdm.id);
    }

    // Owner + m1 send, m2 reads both.
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${gdm.id}/messages`, { data: { content: 'hi from owner' }, headers: auth(owner.token) })).status).toBe(201);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${gdm.id}/messages`, { data: { content: 'reply from m1' }, headers: auth(m1.token) })).status).toBe(201);
    const read = await apiWithRetry(request, 'get', `${API_BASE}/channels/${gdm.id}/messages`, { headers: auth(m2.token) });
    const body = JSON.stringify(await read.json());
    expect(body).toContain('hi from owner');
    expect(body).toContain('reply from m1');
  });

  test('an outsider cannot access the group DM; empty recipients rejected', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'gdo');
    const m1 = await addMemberToGuild(request, owner.token, owner.guildId, 'gdo1');
    const outsider = await registerUser(request, 'gdout');

    const gdm = await (await apiWithRetry(request, 'post', `${API_BASE}/users/@me/channels`, {
      data: { recipients: [m1.userId] }, headers: auth(owner.token),
    })).json() as { id: string };

    const outId = await getCurrentUserId(request, outsider.token); // just to exercise the outsider token
    expect(outId).toBeTruthy();
    expect((await apiWithRetry(request, 'get', `${API_BASE}/channels/${gdm.id}/messages`, { headers: auth(outsider.token) })).status).toBe(403);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/users/@me/channels`, { data: { recipients: [] }, headers: auth(owner.token) })).status).toBe(400);
  });
});
