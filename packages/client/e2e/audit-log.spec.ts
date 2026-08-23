import { test, expect } from '@playwright/test';
import { registerUserWithGuild, addMemberToGuild, createRole, apiWithRetry, API_BASE } from './helpers';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function auditBody(request: any, token: string, guildId: string, actionType: number): Promise<string> {
  const res = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${guildId}/audit-logs?action_type=${actionType}`, { headers: auth(token) });
  expect(res.status).toBe(200);
  return JSON.stringify(await res.json());
}

test.describe('Audit log', () => {
  test('kick, ban, and role create/delete are recorded with the right target', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'al');
    const kicked = await addMemberToGuild(request, owner.token, owner.guildId, 'alk');
    const banned = await addMemberToGuild(request, owner.token, owner.guildId, 'alb');

    await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/members/${kicked.userId}`, { headers: auth(owner.token) });
    await apiWithRetry(request, 'put', `${API_BASE}/guilds/${owner.guildId}/bans/${banned.userId}`, { data: { reason: 'spam' }, headers: auth(owner.token) });
    const role = await createRole(request, owner.token, owner.guildId, { name: 'Temp', permissions: '0' });
    await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/roles/${role.id}`, { headers: auth(owner.token) });

    expect(await auditBody(request, owner.token, owner.guildId, 20)).toContain(kicked.userId);   // MEMBER_KICK
    expect(await auditBody(request, owner.token, owner.guildId, 22)).toContain(banned.userId);   // MEMBER_BAN_ADD
    expect(await auditBody(request, owner.token, owner.guildId, 30)).toContain(role.id);          // ROLE_CREATE
    expect(await auditBody(request, owner.token, owner.guildId, 32)).toContain(role.id);          // ROLE_DELETE
  });

  test('a member without VIEW_AUDIT_LOG cannot read the audit log', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'alp');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'alpm');
    const res = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/audit-logs`, { headers: auth(member.token) });
    expect(res.status).toBe(403);
  });
});
