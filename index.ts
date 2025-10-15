// WebSocket server for real-time job updates
import type { ServerWebSocket } from "bun";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

type WS = ServerWebSocket<unknown>;

// Map: WebSocket → clientId
const clientIds = new Map<WS, string>();

// Map: WebSocket → Set of jobIds
const clientJobs = new Map<WS, Set<string>>();

// Map: jobId → WebSocket
const jobSubscriptions = new Map<string, WS>();

redis.subscribe("job-updates");
redis.on("message", (_channel, msg) => {
  try {
    const update = JSON.parse(msg);
    console.log("📨 Redis message received:", update);

    const ws = jobSubscriptions.get(update.jobId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      const clientId = clientIds.get(ws);
      console.log(
        `📤 Sending update for job ${update.jobId} to client ${clientId}`
      );
      ws.send(JSON.stringify(update));
    } else {
      console.log(
        `⚠️ No active WebSocket subscription for job ${update.jobId}`
      );
      console.log(`📊 Active subscriptions: ${jobSubscriptions.size}`);
      console.log(`📊 Connected clients: ${clientIds.size}`);
    }
  } catch (error) {
    console.error("❌ Error processing Redis message:", error);
  }
});

// Start WebSocket server
Bun.serve({
  port: 8081,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("WebSocket server", { status: 200 });
  },
  websocket: {
    open(ws) {
      const clientId = crypto.randomUUID();
      clientIds.set(ws, clientId);
      clientJobs.set(ws, new Set());
      console.log(`✅ Client connected: ${clientId}`);
      ws.send(JSON.stringify({ type: "connected", clientId }));
    },
    message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        console.log("📨 WebSocket message received:", data);

        if (data.action === "subscribe" && data.jobId) {
          jobSubscriptions.set(data.jobId, ws);
          clientJobs.get(ws)?.add(data.jobId);
          const clientId = clientIds.get(ws);
          console.log(`🔔 Client ${clientId} subscribed to job: ${data.jobId}`);
          console.log(`📊 Total subscriptions now: ${jobSubscriptions.size}`);
          ws.send(JSON.stringify({ type: "subscribed", jobId: data.jobId }));
        }
      } catch (error) {
        console.error("❌ Error processing WebSocket message:", error);
      }
    },
    close(ws) {
      const clientId = clientIds.get(ws);
      const jobs = clientJobs.get(ws);

      // Clean up job subscriptions
      jobs?.forEach((jobId) => jobSubscriptions.delete(jobId));

      clientIds.delete(ws);
      clientJobs.delete(ws);
      console.log(
        `👋 Client disconnected: ${clientId} (had ${jobs?.size || 0} jobs)`
      );
    },
  },
});

console.log("✅ WebSocket server running on ws://localhost:8081");
