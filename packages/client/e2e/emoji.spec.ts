import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, createRole, addRoleToMember, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';
const MANAGE_GUILD_EXPRESSIONS = String(2 ** 30); // 1<<30
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.describe('Custom guild emoji', () => {
  test('owner can create, rename, and delete a custom emoji', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'em');

    const create = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/emojis`, {
      data: { name: 'blobcat', image: IMG }, headers: auth(owner.token),
    });
    expect(create.status).toBe(201);
    const emoji = await create.json() as { id: string; name: string };
    expect(emoji.name).toBe('blobcat');

    const list = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/emojis`, { headers: auth(owner.token) });
    expect((await list.json() as Array<{ id: string }>).map(e => e.id)).toContain(emoji.id);

    const rename = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/emojis/${emoji.id}`, {
      data: { name: 'blobcatrenamed' }, headers: auth(owner.token),
    });
    expect(rename.status).toBe(200);
    expect((await rename.json() as { name: string }).name).toBe('blobcatrenamed');

    const del = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/emojis/${emoji.id}`, { headers: auth(owner.token) });
    expect(del.status).toBe(204);
    const gone = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/emojis/${emoji.id}`, { headers: auth(owner.token) });
    expect(gone.status).toBe(404);
  });

  test('emoji management honours MANAGE_GUILD_EXPRESSIONS (not just owner)', async ({ request }) => {
    // Regression: _require_manage_emojis only checked guild ownership.
    const owner = await registerUserWithGuild(request, 'emp');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'empm');

    // Plain member is denied.
    const denied = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/emojis`, {
      data: { name: 'nope', image: IMG }, headers: auth(member.token),
    });
    expect(denied.status).toBe(403);

    // Grant MANAGE_GUILD_EXPRESSIONS via a role -> member can now manage emoji.
    const role = await createRole(request, owner.token, owner.guildId, { name: 'Emoji Mgr', permissions: MANAGE_GUILD_EXPRESSIONS });
    await addRoleToMember(request, owner.token, owner.guildId, member.userId, role.id);
    const allowed = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/emojis`, {
      data: { name: 'allowed', image: IMG }, headers: auth(member.token),
    });
    expect(allowed.status).toBe(201);
  });

  test('an uploaded emoji image is stored and served same-origin via /cdn', async ({ request }) => {
    // Regression: create_emoji dropped the image; the client got 404 on the emoji URL.
    const owner = await registerUserWithGuild(request, 'emi');
    const id = (await (await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/emojis`, {
      data: { name: 'imgblob', image: IMG }, headers: auth(owner.token),
    })).json() as { id: string }).id;

    const img = await request.get(`${BASE}/cdn/relay-emojis/${id}.png`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/png');
    expect((await img.body()).length).toBeGreaterThan(0);
  });
});
