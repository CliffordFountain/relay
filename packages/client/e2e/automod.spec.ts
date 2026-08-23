import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const RULES = (g: string) => `${API_BASE}/guilds/${g}/auto-moderation/rules`;

test.describe('Automod rules', () => {
  test('owner can create, list, update, and delete a keyword rule', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'am');
    const create = await apiWithRetry(request, 'post', RULES(owner.guildId), {
      data: { name: 'BlockBad', trigger_type: 1, trigger_metadata: { keyword_filter: ['badword'] }, actions: [{ type: 1 }], enabled: true },
      headers: auth(owner.token),
    });
    expect(create.status).toBe(201);
    const rule = await create.json() as { id: string; trigger_type: number };
    expect(rule.trigger_type).toBe(1);

    const list = await apiWithRetry(request, 'get', RULES(owner.guildId), { headers: auth(owner.token) });
    expect((await list.json() as Array<{ id: string }>).map(r => r.id)).toContain(rule.id);

    const patch = await apiWithRetry(request, 'patch', `${RULES(owner.guildId)}/${rule.id}`, {
      data: { name: 'BlockBadRenamed', enabled: false }, headers: auth(owner.token),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ name: 'BlockBadRenamed', enabled: false });

    const del = await apiWithRetry(request, 'delete', `${RULES(owner.guildId)}/${rule.id}`, { headers: auth(owner.token) });
    expect(del.status).toBe(204);
    expect((await (await apiWithRetry(request, 'get', RULES(owner.guildId), { headers: auth(owner.token) })).json() as unknown[])).toHaveLength(0);
  });

  test('automod rule management requires MANAGE_GUILD, and trigger_type is validated', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'amp');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'ampm');
    // Member (no MANAGE_GUILD) denied.
    const denied = await apiWithRetry(request, 'post', RULES(owner.guildId), {
      data: { name: 'x', trigger_type: 1, trigger_metadata: { keyword_filter: ['a'] }, actions: [{ type: 1 }] }, headers: auth(member.token),
    });
    expect(denied.status).toBe(403);
    // Invalid trigger_type rejected.
    const invalid = await apiWithRetry(request, 'post', RULES(owner.guildId), {
      data: { name: 'x', trigger_type: 99, actions: [{ type: 1 }] }, headers: auth(owner.token),
    });
    expect(invalid.status).toBe(400);
  });

  test('an enabled keyword rule blocks a matching message; clean messages pass', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'ame');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'amem');
    await apiWithRetry(request, 'post', RULES(owner.guildId), {
      data: { name: 'Block', trigger_type: 1, trigger_metadata: { keyword_filter: ['badword'] }, actions: [{ type: 1 }], enabled: true },
      headers: auth(owner.token),
    });
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, { data: { content: 'this has badword in it' }, headers: auth(member.token) })).status).toBe(403);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, { data: { content: 'all good here' }, headers: auth(member.token) })).status).toBe(201);
  });
});
