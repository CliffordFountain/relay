import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  registerUserWithGuild, addMemberToGuild, getCurrentUserId,
  createRole, addRoleToMember, apiWithRetry, API_BASE,
} from './helpers';

// Permission bits. MODERATE_MEMBERS is bit 40, beyond JS 32-bit bitwise range, so compute
// with 2**n and pass permissions as strings (the API field is a string).
const KICK_MEMBERS = 2;   // 1<<1
const BAN_MEMBERS = 4;    // 1<<2
const MODERATE = 2 ** 40; // 1<<40
const MOD_PERMS = String(KICK_MEMBERS + BAN_MEMBERS + MODERATE);

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function memberIds(request: APIRequestContext, token: string, guildId: string): Promise<string[]> {
  const res = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${guildId}/members`, { headers: auth(token) });
  const list = await res.json() as Array<{ user: { id: string } }>;
  return list.map(m => m.user.id);
}

/** Create a single-use invite (as owner) and accept it as `userToken`. Returns the join status. */
async function joinViaInvite(
  request: APIRequestContext, ownerToken: string, channelId: string, userToken: string,
): Promise<number> {
  const inv = await apiWithRetry(request, 'post', `${API_BASE}/channels/${channelId}/invites`, {
    data: { max_uses: 1, max_age: 86400 }, headers: auth(ownerToken),
  });
  const code = (await inv.json() as { code: string }).code;
  const res = await apiWithRetry(request, 'post', `${API_BASE}/invites/${code}`, { headers: auth(userToken) });
  return res.status;
}

async function makeModerator(request: APIRequestContext, owner: { token: string; guildId: string }) {
  const mod = await addMemberToGuild(request, owner.token, owner.guildId, 'mod');
  const role = await createRole(request, owner.token, owner.guildId, { name: 'Mod', permissions: MOD_PERMS });
  await addRoleToMember(request, owner.token, owner.guildId, mod.userId, role.id);
  return { mod, roleId: role.id };
}

test.describe('Moderation', () => {
  test('owner kicks a member; member is removed and can rejoin (kick != ban)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'mk');
    const victim = await addMemberToGuild(request, owner.token, owner.guildId, 'vic');

    const kick = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${victim.userId}`, { headers: auth(owner.token) });
    expect(kick.status).toBe(204);
    expect(await memberIds(request, owner.token, owner.guildId)).not.toContain(victim.userId);

    // Kicked (not banned) -> can rejoin with a fresh invite.
    const rejoin = await joinViaInvite(request, owner.token, owner.channelId, victim.token);
    expect(rejoin).toBe(200);
  });

  test('owner bans a member; they are listed and cannot rejoin; unban restores access', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'mb');
    const victim = await addMemberToGuild(request, owner.token, owner.guildId, 'ban');

    const ban = await apiWithRetry(request, 'put', `${API_BASE}/guilds/${owner.guildId}/bans/${victim.userId}`, {
      data: { reason: 'spam' }, headers: auth(owner.token),
    });
    expect(ban.status).toBe(204);

    const bans = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/bans`, { headers: auth(owner.token) });
    const bannedIds = (await bans.json() as Array<{ user: { id: string } }>).map(b => b.user.id);
    expect(bannedIds).toContain(victim.userId);

    // Banned user cannot rejoin even with a valid invite.
    expect(await joinViaInvite(request, owner.token, owner.channelId, victim.token)).toBe(403);

    // Unban -> removed from the ban list -> can rejoin.
    const unban = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/bans/${victim.userId}`, { headers: auth(owner.token) });
    expect(unban.status).toBe(204);
    const bans2 = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/bans`, { headers: auth(owner.token) });
    expect((await bans2.json() as Array<{ user: { id: string } }>).map(b => b.user.id)).not.toContain(victim.userId);
    expect(await joinViaInvite(request, owner.token, owner.channelId, victim.token)).toBe(200);
  });

  test('a plain member (no perms) cannot kick, ban, or list bans (403)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'mp');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'plain');
    const other = await addMemberToGuild(request, owner.token, owner.guildId, 'other');

    const kick = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${other.userId}`, { headers: auth(member.token) });
    expect(kick.status).toBe(403);
    const ban = await apiWithRetry(request, 'put', `${API_BASE}/guilds/${owner.guildId}/bans/${other.userId}`, { headers: auth(member.token) });
    expect(ban.status).toBe(403);
    const list = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/bans`, { headers: auth(member.token) });
    expect(list.status).toBe(403);
  });

  test('a moderator cannot kick or ban the server owner (owner immunity)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'mo');
    const ownerId = await getCurrentUserId(request, owner.token);
    const { mod } = await makeModerator(request, owner);

    const kick = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${ownerId}`, { headers: auth(mod.token) });
    expect(kick.status).toBe(403);
    const ban = await apiWithRetry(request, 'put', `${API_BASE}/guilds/${owner.guildId}/bans/${ownerId}`, { headers: auth(mod.token) });
    expect(ban.status).toBe(403);
  });

  test('the owner cannot kick or ban themselves (400)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'ms');
    const ownerId = await getCurrentUserId(request, owner.token);

    const kick = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${ownerId}`, { headers: auth(owner.token) });
    expect(kick.status).toBe(400);
    const ban = await apiWithRetry(request, 'put', `${API_BASE}/guilds/${owner.guildId}/bans/${ownerId}`, { headers: auth(owner.token) });
    expect(ban.status).toBe(400);
  });

  test('a moderator cannot kick a peer holding the same role (role hierarchy)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'mh');
    const { mod, roleId } = await makeModerator(request, owner);
    // Give a second member the SAME mod role (equal position).
    const peer = await addMemberToGuild(request, owner.token, owner.guildId, 'peer');
    await addRoleToMember(request, owner.token, owner.guildId, peer.userId, roleId);

    const kick = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${peer.userId}`, { headers: auth(mod.token) });
    expect(kick.status).toBe(403);
  });

  test('a moderator CAN kick a lower (role-less) member — delegated moderation works', async ({ request }) => {
    // Regression: role positions were stuck at 0, so require_member_hierarchy blocked every
    // non-owner. A mod (role above @everyone) must be able to kick a role-less member.
    const owner = await registerUserWithGuild(request, 'md');
    const { mod } = await makeModerator(request, owner);
    const target = await addMemberToGuild(request, owner.token, owner.guildId, 'lower');

    const kick = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${target.userId}`, { headers: auth(mod.token) });
    expect(kick.status).toBe(204);
    expect(await memberIds(request, owner.token, owner.guildId)).not.toContain(target.userId);
  });

  test('a timed-out member cannot send messages; clearing the timeout restores it', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'mt');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'timed');
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const set = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/members/${member.userId}`, {
      data: { communication_disabled_until: until }, headers: auth(owner.token),
    });
    expect(set.status).toBe(200);

    // Blocked while timed out.
    const blocked = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, {
      data: { content: 'while timed out' }, headers: auth(member.token),
    });
    expect(blocked.status).toBe(403);

    // Clear the timeout (explicit null) and confirm it is actually cleared + sending works.
    const clear = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/members/${member.userId}`, {
      data: { communication_disabled_until: null }, headers: auth(owner.token),
    });
    expect(clear.status).toBe(200);
    const m = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/members/${member.userId}`, { headers: auth(owner.token) });
    expect((await m.json() as { communication_disabled_until: string | null }).communication_disabled_until).toBeNull();

    const ok = await apiWithRetry(request, 'post', `${API_BASE}/channels/${owner.channelId}/messages`, {
      data: { content: 'after clear' }, headers: auth(member.token),
    });
    expect(ok.status).toBe(201);
  });

  test('the owner can pre-emptively ban an outsider, blocking them from joining', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'mpre');
    const outsider = await addMemberToGuild(request, owner.token, owner.guildId, 'out');
    // Kick first so they are a pure outsider (not a member), then ban by id.
    await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${outsider.userId}`, { headers: auth(owner.token) });

    const ban = await apiWithRetry(request, 'put', `${API_BASE}/guilds/${owner.guildId}/bans/${outsider.userId}`, {
      data: { reason: 'preemptive' }, headers: auth(owner.token),
    });
    expect(ban.status).toBe(204);
    expect(await joinViaInvite(request, owner.token, owner.channelId, outsider.token)).toBe(403);
  });
});
