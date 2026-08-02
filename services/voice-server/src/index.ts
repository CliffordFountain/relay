import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createClient, type RedisClientType } from 'redis';
import { createWorkers } from './mediasoup-config.js';
import { RoomManager } from './room.js';
import { handleSignaling } from './signaling.js';

const PORT = parseInt(process.env.PORT || '4001', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main(): Promise<void> {
  // ── mediasoup workers (1 per CPU core) ───────────────────────────
  const workers = await createWorkers();
  console.log(`Created ${workers.length} mediasoup worker(s)`);

  // ── Room manager ─────────────────────────────────────────────────
  const roomManager = new RoomManager(workers);

  // ── Redis pub/sub to coordinate with main gateway ────────────────
  const redisPub = createClient({ url: REDIS_URL }) as RedisClientType;
  const redisSub = redisPub.duplicate() as RedisClientType;

  await redisPub.connect().catch((err) => {
    console.warn('Redis pub connect failed (voice events will not publish):', err.message);
  });

  await redisSub.connect().catch((err) => {
    console.warn('Redis sub connect failed (will not receive gateway commands):', err.message);
  });

  // Listen for commands from the main gateway (e.g. force-disconnect)
  redisSub.subscribe('voice:commands', (message) => {
    try {
      const cmd = JSON.parse(message) as { type: string; channelId?: string; userId?: string };

      switch (cmd.type) {
        case 'FORCE_DISCONNECT':
          if (cmd.channelId && cmd.userId) {
            const room = roomManager.getRoom(cmd.channelId);
            const peer = room?.peers.get(cmd.userId);
            if (peer) {
              peer.ws.close(4014, 'Disconnected by server');
            }
          }
          break;

        case 'DESTROY_ROOM':
          if (cmd.channelId) {
            const room = roomManager.getRoom(cmd.channelId);
            if (room) {
              // Close all peers
              for (const peer of room.peers.values()) {
                peer.ws.close(4014, 'Channel deleted');
              }
            }
          }
          break;
      }
    } catch {
      // ignore bad messages
    }
  }).catch(() => {});

  // ── HTTP server (health check) ───────────────────────────────────
  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          rooms: roomManager.getRoomCount(),
          workers: workers.length,
          uptime: process.uptime(),
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // ── WebSocket server for voice signaling ─────────────────────────
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    handleSignaling(ws, roomManager, redisPub as RedisClientType);
  });

  // ── Start listening ──────────────────────────────────────────────
  httpServer.listen(PORT, () => {
    console.log(`Voice server listening on port ${PORT}`);
  });

  // ── Graceful shutdown ────────────────────────────────────────────
  const shutdown = async () => {
    console.log('Shutting down voice server...');

    // Close all WebSocket connections
    for (const client of wss.clients) {
      client.close(4000, 'Server shutting down');
    }

    wss.close();
    httpServer.close();

    // Close workers
    for (const worker of workers) {
      worker.close();
    }

    await redisPub.quit().catch(() => {});
    await redisSub.quit().catch(() => {});

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error starting voice server:', err);
  process.exit(1);
});
