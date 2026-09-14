# Using Relay

A quick tour of what you can do once you're signed in. If you haven't got Relay running
yet, start with the [README](../README.md); to run it for real, see
[DEPLOYMENT.md](./DEPLOYMENT.md).

Relay works the same in a browser and in the desktop app — everything below applies to both.

## Servers and channels

- **Make a server** with the **+** button on the left rail. A server is your community; it
  gets a couple of default channels to start.
- **Join a server** by opening an invite link, or from the compass (**Discover**) button if
  the server is listed publicly.
- Inside a server, the left column lists its **channels**, grouped into categories:
  - **Text channels** (`#`) for chat.
  - **Voice channels** for calls.
  - **Forum channels** for threaded, topic-first discussion.
  - **Announcement channels** you can *follow* from other servers to cross-post updates.
- The server-name dropdown (top-left) is where you create channels and categories, invite
  people, and open **Server Settings**.

## Chatting

- Type in the box at the bottom. **Enter** sends; **Shift+Enter** adds a newline.
- **Markdown** works — `**bold**`, `*italics*`, `` `code` ``, code blocks, quotes, spoilers.
- Hover a message for quick actions, or right-click it for the full menu: **reply**,
  **react**, **edit**, **pin**, **forward**, **create a thread**, copy, and (with the right
  permissions) delete.
- **@mention** people and roles; **#mention** channels. Mentions show up in your **Inbox**
  (the tray icon, top-right).
- Attach files with the **+** in the composer, and drop in **emoji**, **GIFs** (GIPHY), or
  **stickers** from the buttons on the right of the composer.
- **Search** a server with the search box in the header — filter by author, channel, date,
  and whether a message has files or links.
- **Threads** keep a side-conversation out of the main channel; open the threads panel from
  the header.

## Voice and video

- Click a **voice channel** to join. The bar at the bottom-left shows you're connected.
- Toggle your **mic** and **deafen** there; turn on your **camera** or **Go Live** to share.
- **Screen share** (desktop app): when you Go Live you get a **"Choose what to share"**
  picker — pick a whole screen or a single application window (a game counts as a window).
  On Windows you can include system audio.
- **Push-to-talk**: in **User Settings → Voice & Video**, switch input mode to Push to Talk
  and set a key. Any key works — including a modifier on its own (Ctrl/Shift/Alt) or a mouse
  side-button. Hold it while connected to talk.
- **Watching two streams at once**: when more than one person is sharing, a small switcher
  appears on the stage — click a name (including **Your screen**) to choose whose share
  fills the big view. Your own share never locks the stage, so you can flip between them.

### Hosting a call for people on your network (Windows firewall)

If you self-host Relay and people on **other computers** can join a voice channel but you
**can't see their camera / screen or hear each other**, the host machine's firewall is
blocking the media. On the computer running Relay, open an **Administrator** PowerShell and
add these rules:

```powershell
New-NetFirewallRule -DisplayName "Relay - Web app (TCP 5173)"            -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173          -Profile Private,Domain
New-NetFirewallRule -DisplayName "Relay - Voice media UDP (40000-40100)" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 40000-40100 -Profile Private,Domain
New-NetFirewallRule -DisplayName "Relay - Voice media TCP (40000-40100)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 40000-40100 -Profile Private,Domain
```

That's all that needs opening — the app proxies everything else through port 5173. Also
make sure `ANNOUNCED_IP` in `.env` is the host's real LAN IP (run
`powershell -File scripts/announce-ip.ps1 -Recreate` to set it automatically).

**To remove these rules later** (e.g. if you stop hosting), one line takes them all back out:

```powershell
Get-NetFirewallRule -DisplayName "Relay - *" | Remove-NetFirewallRule
```

Full details, network-profile notes, and cleanup of any hand-made rules are in
[DEPLOYMENT.md → Firewall](./DEPLOYMENT.md#firewall--voice--video-across-machines-windows).

## Roles, permissions, and moderation

Server owners and admins get the tools to run a real community, under **Server Settings**:

- **Roles** with granular permissions, a colour, and a hierarchy. Assign them to members.
  (You can only grant permissions you hold yourself.)
- **Moderation** — kick and ban members, and an **AutoMod** with keyword rules.
- An **audit log** so moderators can see who changed what.
- **Invites** with optional expiry and use limits.
- **Scheduled events** members can mark themselves interested in.

## Friends and direct messages

- The **Friends** area (home, top-left) is where you add friends and see who's online.
- Open a **DM** with anyone, or start a **group DM** with several people. DMs have the same
  chat features as channels — files, reactions, replies, and calls.

## Settings worth knowing

Open **User Settings** with the gear by your name (bottom-left):

- **My Account / Profile** — avatar (with crop/reposition), banner, display name, password.
- **Voice & Video** — input/output devices, input mode (voice activity vs push-to-talk).
- **Appearance** — theme, message display, font scaling.
- **Keybinds** — rebind shortcuts.
- **Notifications** — per-server and per-channel controls; mute channels you don't want pinged
  by.

## Web or desktop

Relay runs in any modern browser, and as a native desktop app for Windows, macOS, and Linux —
same account, same everything. The desktop app adds a system-tray presence (it keeps running
when you close the window) and the screen/window share picker. Use whichever you prefer.
