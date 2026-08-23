import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, registerUser, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const uniq = () => Math.random().toString(36).slice(2, 8);

test.describe('Vanity URL', () => {
  test('owner sets and reads a vanity URL', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'van');
    const code = `my-server-${uniq()}`;
    const set = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/vanity-url`, {
      data: { code }, headers: auth(owner.token),
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ code });

    const get = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/vanity-url`, { headers: auth(owner.token) });
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ code });
  });

  test('invalid codes are rejected; non-managers cannot set a vanity URL', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'vanv');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'vanm');
    expect((await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/vanity-url`, { data: { code: 'Bad Code!' }, headers: auth(owner.token) })).status).toBe(400);
    expect((await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/vanity-url`, { data: { code: `x-${uniq()}` }, headers: auth(member.token) })).status).toBe(403);
  });

  test('a vanity code cannot be claimed by two guilds', async ({ request }) => {
    const a = await registerUserWithGuild(request, 'vua');
    const b = await registerUserWithGuild(request, 'vub');
    const code = `shared-${uniq()}`;
    expect((await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${a.guildId}/vanity-url`, { data: { code }, headers: auth(a.token) })).status).toBe(200);
    expect((await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${b.guildId}/vanity-url`, { data: { code }, headers: auth(b.token) })).status).toBe(400);
  });

  test('a user joins a guild via its vanity code; a bogus code 404s', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'vj');
    const code = `join-${uniq()}`;
    await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/vanity-url`, { data: { code }, headers: auth(owner.token) });

    const joiner = await registerUser(request, 'vjoin');
    const join = await apiWithRetry(request, 'post', `${API_BASE}/invites/${code}`, { headers: auth(joiner.token) });
    expect(join.status).toBe(200);
    expect(await join.json()).toMatchObject({ id: owner.guildId });

    expect((await apiWithRetry(request, 'post', `${API_BASE}/invites/nope-${uniq()}`, { headers: auth(joiner.token) })).status).toBe(404);
  });
});
