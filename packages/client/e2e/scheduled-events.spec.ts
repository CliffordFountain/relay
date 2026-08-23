import { test, expect } from '@playwright/test';
import {
  registerUserWithGuild, addMemberToGuild, createRole, addRoleToMember,
  enterGeneralChannel, apiWithRetry, API_BASE,
} from './helpers';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const MANAGE_EVENTS = String(2 ** 33); // 1<<33
const futureISO = (hours = 24) => new Date(Date.now() + hours * 3600_000).toISOString();

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

test.describe('Scheduled events', () => {
  test('full CRUD lifecycle (create → list → get → update → delete)', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'ev');
    const create = await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/scheduled-events`, {
      data: { name: 'Game Night', description: 'come play', scheduled_start_time: futureISO(), entity_type: 3 },
      headers: auth(owner.token),
    });
    expect(create.status).toBe(201);
    const ev = await create.json() as { id: string; name: string; status: number };
    expect(ev.name).toBe('Game Night');
    expect(ev.status).toBe(1);

    const list = await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/scheduled-events`, { headers: auth(owner.token) });
    expect((await list.json() as Array<{ id: string }>).map(e => e.id)).toContain(ev.id);

    expect((await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/scheduled-events/${ev.id}`, { headers: auth(owner.token) })).status).toBe(200);

    const patch = await apiWithRetry(request, 'patch', `${API_BASE}/guilds/${owner.guildId}/scheduled-events/${ev.id}`, {
      data: { name: 'Renamed', status: 2 }, headers: auth(owner.token),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ name: 'Renamed', status: 2 });

    expect((await apiWithRetry(request, 'delete', `${API_BASE}/guilds/${owner.guildId}/scheduled-events/${ev.id}`, { headers: auth(owner.token) })).status).toBe(204);
    expect((await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/scheduled-events/${ev.id}`, { headers: auth(owner.token) })).status).toBe(404);
  });

  test('creating requires MANAGE_EVENTS; any member can list; bad start time → 400', async ({ request }) => {
    const owner = await registerUserWithGuild(request, 'evp');
    const member = await addMemberToGuild(request, owner.token, owner.guildId, 'evm');

    expect((await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/scheduled-events`, { data: { name: 'x', scheduled_start_time: futureISO() }, headers: auth(member.token) })).status).toBe(403);
    expect((await apiWithRetry(request, 'get', `${API_BASE}/guilds/${owner.guildId}/scheduled-events`, { headers: auth(member.token) })).status).toBe(200);

    const role = await createRole(request, owner.token, owner.guildId, { name: 'Host', permissions: MANAGE_EVENTS });
    await addRoleToMember(request, owner.token, owner.guildId, member.userId, role.id);
    expect((await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/scheduled-events`, { data: { name: 'Member Event', scheduled_start_time: futureISO() }, headers: auth(member.token) })).status).toBe(201);

    expect((await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/scheduled-events`, { data: { name: 'x', scheduled_start_time: 'not-a-date' }, headers: auth(owner.token) })).status).toBe(400);
  });

  test('a created event appears in the Events list in the UI', async ({ browser, request }) => {
    test.setTimeout(150000);
    const owner = await registerUserWithGuild(request, 'evu');
    await apiWithRetry(request, 'post', `${API_BASE}/guilds/${owner.guildId}/scheduled-events`, {
      data: { name: 'Movie Marathon', scheduled_start_time: futureISO(), entity_type: 3 }, headers: auth(owner.token),
    });

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
    const page = await ctx.newPage();
    try {
      await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });
      await page.getByRole('button', { name: 'Events' }).first().click();
      const modal = page.getByTestId('guild-events-modal');
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(modal.getByText('Movie Marathon')).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});
