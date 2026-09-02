"""Live demo proving sign up, login, channels, messages all work."""
import json
import urllib.request
import asyncio


API = "http://localhost:8000/api/v10"


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers)
    resp = urllib.request.urlopen(req)
    if resp.status == 204:
        return None
    return json.loads(resp.read())


def main():
    print("=" * 60)
    print("  LIVE DEMO: Full Relay Workflow")
    print("=" * 60)

    # 1. SIGN UP
    print("\n1. SIGN UP")
    alice = api("POST", "/auth/register", {
        "username": "Alice", "email": "alice@demo.com", "password": "AlicePass123!"
    })
    print(f"   Alice signed up: {alice['user']['username']} (ID: {alice['user']['id']})")

    bob = api("POST", "/auth/register", {
        "username": "Bob", "email": "bob@demo.com", "password": "BobPass123!"
    })
    print(f"   Bob signed up: {bob['user']['username']} (ID: {bob['user']['id']})")

    # 2. LOGIN
    print("\n2. LOGIN")
    login = api("POST", "/auth/login", {"email": "alice@demo.com", "password": "AlicePass123!"})
    t_alice = login["token"]
    t_bob = bob["token"]
    print(f"   Alice logged in with token: {t_alice[:20]}...")

    # 3. GET PROFILE
    print("\n3. GET PROFILE")
    me = api("GET", "/users/@me", token=t_alice)
    print(f"   Authenticated as: {me['username']} ({me['email']})")

    # 4. CREATE SERVER
    print("\n4. CREATE SERVER")
    guild = api("POST", "/guilds", {"name": "My Awesome Server"}, t_alice)
    g_id = guild["id"]
    general_id = guild["channels"][0]["id"]
    print(f"   Server: \"{guild['name']}\" (ID: {g_id})")
    print(f"   @everyone role created (perms: {guild['roles'][0]['permissions']})")
    print(f"   #general channel created (ID: {general_id})")

    # 5. CREATE CHANNELS
    print("\n5. CREATE CHANNELS")
    ann = api("POST", f"/guilds/{g_id}/channels", {
        "name": "announcements", "type": 0, "topic": "Important updates"
    }, t_alice)
    print(f"   #{ann['name']} (text)")

    voice = api("POST", f"/guilds/{g_id}/channels", {"name": "Voice Chat", "type": 2}, t_alice)
    print(f"   {voice['name']} (voice)")

    memes = api("POST", f"/guilds/{g_id}/channels", {"name": "memes", "type": 0}, t_alice)
    print(f"   #{memes['name']} (text)")

    channels = api("GET", f"/guilds/{g_id}/channels", token=t_alice)
    print(f"   Total: {len(channels)} channels")

    # 6. SEND MESSAGES
    print("\n6. SEND MESSAGES")
    m1 = api("POST", f"/channels/{general_id}/messages", {"content": "Welcome to the server!"}, t_alice)
    print(f"   [{m1['author']['username']}]: {m1['content']}")

    m2 = api("POST", f"/channels/{ann['id']}/messages", {
        "content": "**Server Rules**\n1. Be respectful\n2. No spam\n3. Have fun!"
    }, t_alice)
    print(f"   [#{ann['name']}] {m2['author']['username']}: {m2['content'][:50]}...")

    # 7. INVITE BOB
    print("\n7. INVITE & JOIN")
    invite = api("POST", f"/channels/{general_id}/invites", {"max_age": 86400}, t_alice)
    print(f"   Invite code: {invite['code']}")

    join = api("POST", f"/invites/{invite['code']}", token=t_bob)
    print(f"   Bob joined \"{join['name']}\"!")

    # 8. BOB MESSAGES
    print("\n8. BOB CHATS")
    bm = api("POST", f"/channels/{general_id}/messages", {
        "content": "Hey everyone! Thanks for the invite!"
    }, t_bob)
    print(f"   [{bm['author']['username']}]: {bm['content']}")

    reply = api("POST", f"/channels/{general_id}/messages", {
        "content": "Welcome Bob!",
        "message_reference": {"message_id": bm["id"]}
    }, t_alice)
    print(f"   [{reply['author']['username']}] (reply): {reply['content']}")

    # 9. REACTIONS
    print("\n9. REACTIONS")
    api("PUT", f"/channels/{general_id}/messages/{bm['id']}/reactions/%F0%9F%91%8B/@me", token=t_alice)
    print("   Alice reacted with wave emoji")

    # 10. PIN
    print("\n10. PIN RULES")
    api("PUT", f"/channels/{ann['id']}/pins/{m2['id']}", token=t_alice)
    pins = api("GET", f"/channels/{ann['id']}/pins", token=t_alice)
    print(f"   Pinned {len(pins)} message in #announcements")

    # 11. ROLES
    print("\n11. ROLES")
    mod = api("POST", f"/guilds/{g_id}/roles", {
        "name": "Moderator", "color": 3066993, "hoist": True, "permissions": "8"
    }, t_alice)
    print(f"   Created: {mod['name']} (color: #{mod['color']:06x})")
    api("PUT", f"/guilds/{g_id}/members/{bob['user']['id']}/roles/{mod['id']}", token=t_alice)
    print(f"   Assigned Moderator to Bob")

    # 12. DMs
    print("\n12. DIRECT MESSAGES")
    dm = api("POST", "/users/@me/channels", {"recipient_id": bob["user"]["id"]}, t_alice)
    dm_msg = api("POST", f"/channels/{dm['id']}/messages", {
        "content": "Hey Bob, you are now a Moderator!"
    }, t_alice)
    print(f"   Alice -> Bob: \"{dm_msg['content']}\"")

    # 13. FRIENDS
    print("\n13. FRIENDS")
    api("PUT", f"/users/@me/relationships/{bob['user']['id']}", {"type": 1}, t_alice)
    api("PUT", f"/users/@me/relationships/{alice['user']['id']}", {"type": 1}, t_bob)
    rels = api("GET", "/users/@me/relationships", token=t_alice)
    print(f"   Alice and Bob are now friends (type={rels[0]['type']})")

    # 14. MESSAGE HISTORY
    print("\n14. MESSAGE HISTORY (#general)")
    msgs = api("GET", f"/channels/{general_id}/messages?limit=50", token=t_alice)
    for m in reversed(msgs):
        print(f"   [{m['author']['username']}]: {m['content'][:55]}")

    # 15. GATEWAY
    print("\n15. GATEWAY WEBSOCKET")
    import websockets

    async def gw():
        async with websockets.connect("ws://localhost:4000/gateway") as ws:
            hello = json.loads(await ws.recv())
            print(f"   Hello received (heartbeat: {hello['d']['heartbeat_interval']}ms)")
            await ws.send(json.dumps({
                "op": 2, "d": {"token": t_alice, "intents": 513,
                               "properties": {"os": "demo", "browser": "demo", "device": "demo"}}
            }))
            ready = json.loads(await ws.recv())
            print(f"   READY! v={ready['d']['v']}, session={ready['d']['session_id'][:12]}...")
            await ws.send(json.dumps({"op": 1, "d": None}))
            ack = json.loads(await ws.recv())
            print(f"   Heartbeat ACK (op {ack['op']})")

    asyncio.run(gw())

    # 16. SETTINGS
    print("\n16. SETTINGS")
    api("PATCH", "/users/@me/settings", {"theme": "dark", "locale": "en-US"}, t_alice)
    s = api("GET", "/users/@me/settings", token=t_alice)
    print(f"   Theme: {s['theme']}, Locale: {s['locale']}")

    print()
    print("=" * 60)
    print("  CONFIRMED: Everything works.")
    print("  Sign up, login, servers, channels, messages, replies,")
    print("  reactions, pins, DMs, friends, roles, invites,")
    print("  gateway WebSocket, settings - all functional.")
    print("=" * 60)


if __name__ == "__main__":
    main()
