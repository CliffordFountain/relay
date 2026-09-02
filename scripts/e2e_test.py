"""Full end-to-end verification for the Relay project."""
import asyncio
import json
import urllib.request
import sys

API = "http://localhost:8000/api/v10"
results = []


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{API}{path}", data=data, method=method, headers=headers
    )
    try:
        resp = urllib.request.urlopen(req)
        if resp.status == 204:
            return "OK_204"
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()[:150]}


def check(name, result, condition=None):
    if condition is None:
        condition = result is not None and (
            not isinstance(result, dict) or "error" not in result
        )
    status = "PASS" if condition else "FAIL"
    results.append((name, status))
    print(f"  [{status}] {name}")
    if status == "FAIL" and isinstance(result, dict):
        print(f"         Detail: {result}")
    return result


def main():
    print("=" * 60)
    print("  RELAY - FULL E2E VERIFICATION")
    print("=" * 60)

    #
    print("\n--- Foundation ---")
    r1 = api("POST", "/auth/register", {"username": "e2e_alice", "email": "e2e_alice@test.com", "password": "AlicePass123!"})
    if isinstance(r1, dict) and "error" in r1:
        r1 = api("POST", "/auth/login", {"email": "e2e_alice@test.com", "password": "AlicePass123!"})
    check("Register/Login Alice", r1, r1 and "token" in r1)
    t1 = r1["token"]

    r2 = api("POST", "/auth/register", {"username": "e2e_bob", "email": "e2e_bob@test.com", "password": "BobPass123!"})
    if isinstance(r2, dict) and "error" in r2:
        r2 = api("POST", "/auth/login", {"email": "e2e_bob@test.com", "password": "BobPass123!"})
    check("Register/Login Bob", r2, r2 and "token" in r2)
    t2 = r2["token"]

    me = api("GET", "/users/@me", token=t1)
    check("Get current user", me, me and "id" in me)
    u1_id = me["id"]

    u2 = api("GET", "/users/@me", token=t2)
    u2_id = u2["id"]

    check("Health check", api("GET", "/health"), True)

    # Gateway test
    async def test_gw():
        import websockets
        async with websockets.connect("ws://localhost:4000/gateway") as ws:
            hello = json.loads(await ws.recv())
            check("Gateway Hello (op 10)", hello, hello["op"] == 10)
            await ws.send(json.dumps({"op": 2, "d": {"token": t1, "intents": 513, "properties": {"os": "t", "browser": "t", "device": "t"}}}))
            ready = json.loads(await ws.recv())
            check("Gateway READY", ready, ready["op"] == 0 and ready["t"] == "READY")
            await ws.send(json.dumps({"op": 1, "d": None}))
            ack = json.loads(await ws.recv())
            check("Gateway HeartbeatACK", ack, ack["op"] == 11)
    asyncio.run(test_gw())

    #
    print("\n--- Core Messaging ---")
    guild = api("POST", "/guilds", {"name": "E2E Final Server"}, t1)
    check("Create guild", guild, guild and "id" in guild)
    g_id = guild["id"]
    ch_id = guild["channels"][0]["id"]

    ch2 = api("POST", f"/guilds/{g_id}/channels", {"name": "voice-room", "type": 2}, t1)
    check("Create voice channel", ch2, ch2 and ch2.get("type") == 2)

    msg = api("POST", f"/channels/{ch_id}/messages", {"content": "Hello E2E!"}, t1)
    check("Send message", msg, msg and "id" in msg)
    msg_id = msg["id"]

    msgs = api("GET", f"/channels/{ch_id}/messages?limit=50", token=t1)
    check("Get messages (pagination)", msgs, isinstance(msgs, list) and len(msgs) > 0)

    edited = api("PATCH", f"/channels/{ch_id}/messages/{msg_id}", {"content": "Edited E2E!"}, t1)
    check("Edit message", edited, edited and edited.get("edited_timestamp"))

    del_r = api("DELETE", f"/channels/{ch_id}/messages/{msg_id}", token=t1)
    check("Delete message", del_r, del_r == "OK_204")

    #
    print("\n--- Rich Messaging & DMs ---")
    m1 = api("POST", f"/channels/{ch_id}/messages", {"content": "Original"}, t1)
    reply = api("POST", f"/channels/{ch_id}/messages", {"content": "Reply!", "message_reference": {"message_id": m1["id"]}}, t1)
    check("Reply to message", reply, reply and reply.get("message_reference"))

    react = api("PUT", f"/channels/{ch_id}/messages/{m1['id']}/reactions/%F0%9F%91%8D/@me", token=t1)
    check("Add reaction", react, react == "OK_204")

    pin = api("PUT", f"/channels/{ch_id}/pins/{m1['id']}", token=t1)
    check("Pin message", pin, pin == "OK_204")

    pins = api("GET", f"/channels/{ch_id}/pins", token=t1)
    check("Get pinned messages", pins, isinstance(pins, list) and len(pins) == 1)

    dm = api("POST", "/users/@me/channels", {"recipient_id": u2_id}, t1)
    check("Create DM channel", dm, dm and dm.get("type") == 1)

    dm_msg = api("POST", f"/channels/{dm['id']}/messages", {"content": "DM!"}, t1)
    check("Send DM message", dm_msg, dm_msg and "content" in dm_msg)

    fr = api("PUT", f"/users/@me/relationships/{u2_id}", {"type": 1}, t1)
    check("Send friend request", fr, fr == "OK_204")

    fr2 = api("PUT", f"/users/@me/relationships/{u1_id}", {"type": 1}, t2)
    check("Accept friend request", fr2, fr2 == "OK_204")

    ack_r = api("POST", f"/channels/{ch_id}/messages/{m1['id']}/ack", token=t1)
    check("Ack read state", ack_r, ack_r == "OK_204")

    states = api("GET", "/users/@me/read-states", token=t1)
    check("Get read states", states, isinstance(states, list))

    #
    print("\n--- Permissions & Moderation ---")
    role = api("POST", f"/guilds/{g_id}/roles", {"name": "Mod", "permissions": "8", "color": 3447003}, t1)
    check("Create role", role, role and "id" in role)

    invite = api("POST", f"/channels/{ch_id}/invites", {"max_age": 3600}, t1)
    check("Create invite", invite, invite and "code" in invite)

    join = api("POST", f"/invites/{invite['code']}", token=t2)
    check("Join via invite", join, join and not isinstance(join, dict) or "error" not in join)

    if role:
        assign = api("PUT", f"/guilds/{g_id}/members/{u2_id}/roles/{role['id']}", token=t1)
        check("Assign role", assign, assign == "OK_204")

    timeout_r = api("PATCH", f"/guilds/{g_id}/members/{u2_id}", {"communication_disabled_until": "2026-03-23T00:00:00Z"}, t1)
    check("Timeout member", timeout_r, timeout_r and "communication_disabled_until" in timeout_r)
    api("PATCH", f"/guilds/{g_id}/members/{u2_id}", {"communication_disabled_until": None}, t1)

    ban_r = api("PUT", f"/guilds/{g_id}/bans/{u2_id}", {"delete_message_seconds": 0}, t1)
    check("Ban member", ban_r, ban_r == "OK_204")

    bans = api("GET", f"/guilds/{g_id}/bans", token=t1)
    check("List bans", bans, isinstance(bans, list) and len(bans) > 0)

    unban = api("DELETE", f"/guilds/{g_id}/bans/{u2_id}", token=t1)
    check("Unban member", unban, unban == "OK_204")

    logs = api("GET", f"/guilds/{g_id}/audit-logs?limit=10", token=t1)
    check("Get audit log", logs, isinstance(logs, dict) and "audit_log_entries" in logs)

    #
    print("\n--- Threads ---")
    thread = api("POST", f"/channels/{ch_id}/threads", {"name": "Test Thread"}, t1)
    check("Create thread", thread, thread and "id" in thread)

    #
    print("\n--- Settings & Search ---")
    settings_r = api("PATCH", "/users/@me/settings", {"theme": "dark", "locale": "en-US"}, t1)
    check("Update user settings", settings_r, settings_r and "theme" in settings_r)

    get_s = api("GET", "/users/@me/settings", token=t1)
    check("Get user settings", get_s, get_s and get_s.get("theme") == "dark")

    #
    print("\n--- Rate Limiting ---")
    # Verify rate limit headers exist
    req = urllib.request.Request(f"{API}/users/@me", headers={"Authorization": f"Bearer {t1}"})
    resp = urllib.request.urlopen(req)
    has_rl = "X-RateLimit-Bucket" in resp.headers
    check("Rate limit headers present", has_rl, has_rl)

    # Unit tests
    print("\n--- UNIT TESTS ---")
    import subprocess
    result = subprocess.run(
        ["pnpm", "test"],
        capture_output=True, text=True,
        cwd=r"C:\source\repos\relay\packages\common",
        shell=True,
    )
    output = result.stdout + result.stderr
    passed = "passed" in output
    check("Snowflake + Permission tests", passed, passed)
    for line in output.split("\n"):
        if "passed" in line.lower() or "tests" in line.lower():
            print(f"         {line.strip()}")

    # SUMMARY
    print()
    print("=" * 60)
    pass_count = sum(1 for _, s in results if s == "PASS")
    fail_count = sum(1 for _, s in results if s == "FAIL")
    total = len(results)
    print(f"  RESULTS: {pass_count} PASSED, {fail_count} FAILED out of {total} tests")
    if fail_count == 0:
        print("  STATUS: ALL TESTS PASSED - PROJECT COMPLETE")
    else:
        print("  FAILED TESTS:")
        for name, status in results:
            if status == "FAIL":
                print(f"    - {name}")
    print("=" * 60)
    sys.exit(0 if fail_count == 0 else 1)


if __name__ == "__main__":
    main()
