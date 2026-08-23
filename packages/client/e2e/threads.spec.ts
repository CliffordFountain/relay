import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe('Threads', () => {
  test('create a thread, post in it, join and leave, and list active', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'th');

    const create = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/threads`, {
      data: { name: 'Discussion', type: 11, auto_archive_duration: 1440 }, headers: auth(owner.token),
    });
    expect(create.status).toBe(201);
    const thread = await create.json() as { id: string; type: number; parent_id: string };
    expect(thread.type).toBe(11);
    expect(thread.parent_id).toBe(owner.channelId);

    const post = await apiWithRetry(request, 'post', `${API_BASE}/channels/${thread.id}/messages`, {
      data: { content: 'hello inside the thread' }, headers: auth(owner.token),
    });
    expect(post.status).toBe(201);

    // Join — regression: this used to 500 (read channel.archived on a Channel proto).
    const join = await apiWithRetry(request, 'put', `${API_BASE}/channels/${thread.id}/thread-members/@me`, { headers: auth(owner.token) });
    expect(join.status).toBe(204);
    const leave = await apiWithRetry(request, 'delete', `${API_BASE}/channels/${thread.id}/thread-members/@me`, { headers: auth(owner.token) });
    expect(leave.status).toBe(204);

    const active = await apiWithRetry(request, 'get', `${API_BASE}/channels/${owner.channelId}/threads/active`, { headers: auth(owner.token) });
    expect(active.status).toBe(200);
    const ids = (await active.json() as { threads: Array<{ id: string }> }).threads.map(t => t.id);
    expect(ids).toContain(thread.id);
  });

  test('create a thread anchored to a message; 404 for a bad message id', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'thm');
    const msg = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, {
      data: { content: 'anchor me' }, headers: auth(owner.token),
    });
    const mid = (await msg.json() as { id: string }).id;

    const ok = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages/${mid}/threads`, {
      data: { name: 'From Msg', type: 11 }, headers: auth(owner.token),
    });
    expect(ok.status).toBe(201);

    const bad = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages/999999999999/threads`, {
      data: { name: 'Nope', type: 11 }, headers: auth(owner.token),
    });
    expect(bad.status).toBe(404);
  });

  test('thread posting is gated by SEND_MESSAGES_IN_THREADS (deny by default, allow via overwrite)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'thg');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'thmem');
    const thread = await (await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/threads`, {
      data: { name: 'Gated', type: 11 }, headers: auth(owner.token),
    })).json() as { id: string };

    // Default @everyone lacks SEND_MESSAGES_IN_THREADS -> 403.
    const blocked = await apiWithRetry(request, 'post', `${API_BASE}/channels/${thread.id}/messages`, {
      data: { content: 'x' }, headers: auth(member.token),
    });
    expect(blocked.status).toBe(403);

    // Grant it via a member overwrite on the PARENT channel (thread perms inherit parent).
    const allow = String(2 ** 38); // SEND_MESSAGES_IN_THREADS
    const ow = await apiWithRetry(request, 'put', `${API_BASE}/channels/${owner.channelId}/permissions/${member.userId}`, {
      data: { type: 1, allow, deny: '0' }, headers: auth(owner.token),
    });
    expect(ow.status).toBe(204);
    const ok = await apiWithRetry(request, 'post', `${API_BASE}/channels/${thread.id}/messages`, {
      data: { content: 'now allowed' }, headers: auth(member.token),
    });
    expect(ok.status).toBe(201);
  });
});
