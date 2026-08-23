import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe('Webhooks', () => {
  test('create → execute (message posts) → delete lifecycle', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'wh');
    const create = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/webhooks`, {
      data: { name: 'E2E Hook' }, headers: auth(owner.token),
    });
    expect(create.status).toBe(201);
    const hook = await create.json() as { id: string; token: string };
    expect(hook.token).toBeTruthy();

    const list = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/webhooks`, { headers: auth(owner.token) });
    expect((await list.json() as Array<{ id: string }>).map(w => w.id)).toContain(hook.id);

    // Execute (unauthenticated) with content -> message appears in the channel.
    const exec = await apiWithRetry(request, 'post', `${API_BASE}/webhooks/${hook.id}/${hook.token}`, { data: { content: 'Hello from webhook' } });
    expect(exec.status).toBe(200);
    const msgs = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/messages`, { headers: auth(owner.token) });
    expect(JSON.stringify(await msgs.json())).toContain('Hello from webhook');

    // Empty execute rejected; bad token 404.
    expect((await apiWithRetry(request, 'post', `${API_BASE}/webhooks/${hook.id}/${hook.token}`, { data: {} })).status).toBe(400);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/webhooks/${hook.id}/deadbeeftoken`, { data: { content: 'x' } })).status).toBe(404);

    // Delete -> subsequent execute 404.
    expect((await apiWithRetry(request, 'delete', `${API_BASE}/webhooks/${hook.id}`, { headers: auth(owner.token) })).status).toBe(204);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/webhooks/${hook.id}/${hook.token}`, { data: { content: 'x' } })).status).toBe(404);
  });

  test('creating/listing webhooks requires MANAGE_WEBHOOKS', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'whp');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'whpm');
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/webhooks`, { data: { name: 'x' }, headers: auth(member.token) })).status).toBe(403);
    expect((await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/webhooks`, { headers: auth(member.token) })).status).toBe(403);
  });
});
