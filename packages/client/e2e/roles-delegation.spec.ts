import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  registerUserWithGuild, addMemberToGuild, createRole, addRoleToMember,
  apiWithRetry, API_BASE,
} from './helpers';

const MANAGE_ROLES = String(2 ** 28); // 1<<28
const ADMINISTRATOR = '8';            // 1<<3

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function createRoleRaw(
  request: APIRequestContext, token: string, guildId: string, name: string, permissions: string,
) {
  return apiWithRetry(request, 'post', `${API_BASE}/guilds/${guildId}/roles`, {
    data: { name, permissions }, headers: auth(token),
  });
}

test.describe('Roles — delegation & guards', () => {
  test('newly created roles get increasing positions (not all 0)', async ({ request }) => {
    // Regression: create_role hardcoded position 0, breaking all role hierarchy.
    const owner = await registerUserWithGuild(request, 'rp');
    const r1 = await createRole(request, owner.token, owner.guildId, { name: 'R1', permissions: '0' });
    const r2 = await createRole(request, owner.token, owner.guildId, { name: 'R2', permissions: '0' });
    // Read them back to get positions.
    const list = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/roles`, { headers: auth(owner.token) });
    const roles = await list.json() as Array<{ id: string; position: number }>;
    const p1 = roles.find(r => r.id === r1.id)!.position;
    const p2 = roles.find(r => r.id === r2.id)!.position;
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(p1);
  });

  test('a MANAGE_ROLES holder can edit a lower role but not their own (hierarchy)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'rd');
    const low = await createRole(request, owner.token, owner.guildId, { name: 'Low', permissions: '0' });   // position 1
    const admin = await createRole(request, owner.token, owner.guildId, { name: 'Admin', permissions: MANAGE_ROLES }); // position 2
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'del');
    await addRoleToMember(request, owner.token, owner.guildId, member.userId, admin.id);

    // Can edit the lower role...
    const editLow = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/roles/${low.id}`, {
      data: { name: 'LowRenamed' }, headers: auth(member.token),
    });
    expect(editLow.status).toBe(200);

    // ...but NOT their own (equal position) role.
    const editOwn = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/roles/${admin.id}`, {
      data: { name: 'Nope' }, headers: auth(member.token),
    });
    expect(editOwn.status).toBe(403);
  });

  test('revoking MANAGE_ROLES is enforced immediately (permission cache invalidated)', async ({ request }) => {
    // Regression: perms cache (120s TTL) was never invalidated, so a revoked role stayed
    // effective for up to 2 minutes.
    const owner = await registerUserWithGuild(request, 'rc');
    const mgr = await createRole(request, owner.token, owner.guildId, { name: 'Mgr', permissions: MANAGE_ROLES });
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'rev');
    await addRoleToMember(request, owner.token, owner.guildId, member.userId, mgr.id);

    // Uses the permission (populates the cache).
    const before = await createRoleRaw(request, member.token, owner.guildId, 'made', '0');
    expect(before.status).toBe(201);

    // Revoke, then IMMEDIATELY try again -> must be denied (no 120s stale window).
    const remove = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${member.userId}/roles/${mgr.id}`, { headers: auth(owner.token) });
    expect(remove.status).toBe(204);
    const after = await createRoleRaw(request, member.token, owner.guildId, 'stale', '0');
    expect(after.status).toBe(403);
  });

  test('a non-admin cannot mint a role granting permissions they lack (elevation guard)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 're');
    const mgr = await createRole(request, owner.token, owner.guildId, { name: 'Mgr', permissions: MANAGE_ROLES });
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'esc');
    await addRoleToMember(request, owner.token, owner.guildId, member.userId, mgr.id);

    // Cannot grant ADMINISTRATOR (a bit they don't hold).
    const escalate = await createRoleRaw(request, member.token, owner.guildId, 'sneaky', ADMINISTRATOR);
    expect(escalate.status).toBe(403);
    // Can create a role with only permissions they DO hold.
    const ok = await createRoleRaw(request, member.token, owner.guildId, 'fine', MANAGE_ROLES);
    expect(ok.status).toBe(201);
  });

  test('the @everyone role cannot be renamed or deleted', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'rev2');
    // @everyone role id == guild id.
    const rename = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/roles/${owner.guildId}`, {
      data: { name: 'everyone-renamed' }, headers: auth(owner.token),
    });
    expect(rename.status).toBe(400);
    const del = await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/roles/${owner.guildId}`, { headers: auth(owner.token) });
    expect(del.status).toBe(400);
  });
});
