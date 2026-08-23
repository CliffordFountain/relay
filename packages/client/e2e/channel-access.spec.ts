import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, createRole, addRoleToMember, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const VIEW_CHANNEL = '1024';   // 1<<10
const SEND_MESSAGES = 2048;    // 1<<11

async function makeChannel(request: any, ownerToken: string, guildId: string, name: string) {
  const res = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${guildId}/channels`, {
    data: { name, type: 0 }, headers: auth(ownerToken),
  });
  return (await res.json() as { id: string }).id;
}

test.describe('Channel access control', () => {
  test('a private channel (VIEW_CHANNEL denied) is unreadable to a member, readable to owner', async ({ request }) => {
    // Regression/security: get_channel_with_access only checked membership, so any member
    // could read a channel with VIEW_CHANNEL denied.
    const owner = await registerUserWithGuild(request, 'pc');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'pcm');
    const chId = await makeChannel(request, owner.token, owner.guildId, 'secret-room');
    await apiWithRetry(request, 'post', `${API_BASE}/channels/${chId}/messages`, { data: { content: 'owner secret' }, headers: auth(owner.token) });

    // Deny VIEW_CHANNEL for @everyone (overwrite id == guild id, type 0 = role).
    const deny = await apiWithRetry(request, 'put', `${API_BASE}/channels/${chId}/permissions/${owner.guildId}`, {
      data: { type: 0, allow: '0', deny: VIEW_CHANNEL }, headers: auth(owner.token),
    });
    expect(deny.status).toBe(204);

    // Member cannot read messages; owner still can.
    const memberRead = await apiWithRetry(request, 'get', `${API_BASE}/channels/${chId}/messages`, { headers: auth(member.token) });
    expect(memberRead.status).toBe(403);
    const ownerRead = await apiWithRetry(request, 'get', `${API_BASE}/channels/${chId}/messages`, { headers: auth(owner.token) });
    expect(ownerRead.status).toBe(200);
    // And cannot post.
    const memberPost = await apiWithRetry(request, 'post', `${API_BASE}/channels/${chId}/messages`, { data: { content: 'x' }, headers: auth(member.token) });
    expect(memberPost.status).toBe(403);
  });

  test('granting VIEW_CHANNEL to a role restores access for members with that role', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'pcg');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'pcgm');
    const chId = await makeChannel(request, owner.token, owner.guildId, 'vip-room');
    // Hide from @everyone.
    await apiWithRetry(request, 'put', `${API_BASE}/channels/${chId}/permissions/${owner.guildId}`, {
      data: { type: 0, allow: '0', deny: VIEW_CHANNEL }, headers: auth(owner.token),
    });
    // Member denied at first.
    expect((await apiWithRetry(request, 'get', `${API_BASE}/channels/${chId}/messages`, { headers: auth(member.token) })).status).toBe(403);

    // Create a VIP role, allow VIEW_CHANNEL + SEND_MESSAGES on the channel, assign to member.
    const role = await createRole(request, owner.token, owner.guildId, { name: 'VIP', permissions: '0' });
    await addRoleToMember(request, owner.token, owner.guildId, member.userId, role.id);
    const allow = String(Number(VIEW_CHANNEL) + SEND_MESSAGES);
    await apiWithRetry(request, 'put', `${API_BASE}/channels/${chId}/permissions/${role.id}`, {
      data: { type: 0, allow, deny: '0' }, headers: auth(owner.token),
    });

    expect((await apiWithRetry(request, 'get', `${API_BASE}/channels/${chId}/messages`, { headers: auth(member.token) })).status).toBe(200);
    const post = await apiWithRetry(request, 'post', `${API_BASE}/channels/${chId}/messages`, { data: { content: 'vip hello' }, headers: auth(member.token) });
    expect(post.status).toBe(201);
  });

  test('a SEND_MESSAGES deny overwrite blocks a member from posting (but owner still can)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'so');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'som');
    // Deny SEND_MESSAGES for @everyone on #general.
    await apiWithRetry(request, 'put', `${API_BASE}/channels/${owner.channelId}/permissions/${owner.guildId}`, {
      data: { type: 0, allow: '0', deny: String(SEND_MESSAGES) }, headers: auth(owner.token),
    });
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, { data: { content: 'x' }, headers: auth(member.token) })).status).toBe(403);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, { data: { content: 'owner ok' }, headers: auth(owner.token) })).status).toBe(201);
  });

  test('slowmode limits a member to one message per interval; MANAGE_MESSAGES bypasses', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'sm');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'smm');
    await apiWithRetry(request, 'patch', `${API_BASE}/channels/${owner.channelId}`, {
      data: { rate_limit_per_user: 30 }, headers: auth(owner.token),
    });
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, { data: { content: 'first' }, headers: auth(member.token) })).status).toBe(201);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, { data: { content: 'too fast' }, headers: auth(member.token) })).status).toBe(429);
    // Owner has MANAGE_MESSAGES and is exempt.
    expect((await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, { data: { content: 'owner unlimited' }, headers: auth(owner.token) })).status).toBe(201);
  });
});
