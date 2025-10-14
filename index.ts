import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import { PubSub } from "@google-cloud/pubsub";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";

// --- Initialize Prisma ORM (for persistent logging & notifications) ---
const prisma = new PrismaClient();

// --- Type augmentation for WebSocket ---
type WS = WebSocket & { userId?: string };

// --- Setup base HTTP + WebSocket server ---
const server = http.createServer();
const wss = new WebSocketServer({ server });

// --- Connected user sessions in memory ---
// Each userId maps to a Set of active WebSocket connections
const clients = new Map<string, Set<WS>>();

/** Add a WebSocket client to the tracking map */
function add(userId: string, ws: WS) {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  ws.userId = userId;
  set.add(ws);
}

/** Remove a WebSocket client (on disconnect or error) */
function remove(ws: WS) {
  const id = ws.userId;
  if (!id) return;
  const set = clients.get(id);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clients.delete(id);
}

/** Send a message payload to all connected clients for a given user */
function send(userId: string, payload: unknown) {
  const set = clients.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// ==================================================================================
// --- 🔹 WebSocket connection handling ---
// ==================================================================================
wss.on("connection", (ws: WS) => {
  let registered = false;

  ws.on("message", (data) => {
    if (registered) return; // Ignore subsequent messages
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "register" && typeof msg.userId === "string") {
        add(msg.userId, ws);
        registered = true;
        ws.send(JSON.stringify({ type: "registered", userId: msg.userId }));
      } else {
        ws.close(1003, "First message must be register");
      }
    } catch {
      ws.close(1003, "Invalid JSON");
    }
  });

  ws.on("close", () => remove(ws));
  ws.on("error", () => remove(ws));
});

// ==================================================================================
// --- 🔹 Redis Client (optional, for job updates or caching if used in parallel) ---
// ==================================================================================
const redisClient = new Redis(process.env.REDIS_URL as string);
redisClient.on("connect", () => console.log("✅ Redis connected"));
redisClient.on("error", (err) => console.error("❌ Redis error:", err));

// ==================================================================================
// --- 🔸 GOOGLE CLOUD PUB/SUB SECTION ---
// --- Handles "new_screen_call" and "problem_done" messages from Worker/Queue
// ==================================================================================

async function start() {
  const pubsub = new PubSub();

  // --- 1️⃣ Subscription: new_screen_call ---
  const newScreenCallSub = pubsub.subscription("new_screen_call-sub");
  newScreenCallSub.on("message", async (message) => {
    try {
      const m = JSON.parse(message.data.toString());
      if (m?.userId) {
        console.log("📞 WS sending new_screen_call →", m.userId);

        // Log to user action log
        await prisma.userActionLog.create({
          data: {
            userId: m.userId,
            title: "New Screen Call",
            content: "A new screen call event was triggered.",
          },
        });

        // Create persistent notification record
        await prisma.notification.create({
          data: {
            userId: m.userId,
            type: "new_screen_call",
            data: {
              title: "New Screen Call Started",
              status: "Queued",
            },
            read: false,
          },
        });

        // Send real-time message via WebSocket
        send(m.userId, { type: "new_screen_call" });
      }
      message.ack();
    } catch (err) {
      console.error("❌ Failed to handle new_screen_call:", err);
      message.nack();
    }
  });

  // --- 2️⃣ Subscription: problem_done ---
  const problemDoneSub = pubsub.subscription("problem_done-sub");
  problemDoneSub.on("message", async (message) => {
    try {
      const m = JSON.parse(message.data.toString());
      if (m?.userId) {
        console.log("✅ WS sending problem_done →", m.userId);

        // Log completion in user action log
        await prisma.userActionLog.create({
          data: {
            userId: m.userId,
            title: "Problem Done",
            content: `Product ${m.productName ?? m.productId} marked as ${m.status}`,
          },
        });

        // Create persistent notification record
        await prisma.notification.create({
          data: {
            userId: m.userId,
            type: "problem_done",
            data: {
              title: m.productName || `Job ${m.productId}`,
              status: m.status || "Completed",
            },
            read: false,
          },
        });

        // Send real-time message via WebSocket
        send(m.userId, {
          type: "problem_done",
          productId: m.productId,
          status: m.status,
          productName: m.productName,
        });
      }
      message.ack();
    } catch (err) {
      console.error("❌ Failed to handle problem_done:", err);
      message.nack();
    }
  });

  // --- 3️⃣ Start HTTP + WebSocket server ---
  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => console.log(`🌐 WS Server listening on port ${port}`));
}

// ==================================================================================
// --- 🔹 Graceful shutdown ---
// ==================================================================================
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await prisma.$disconnect();
  redisClient.disconnect();
  process.exit(0);
});

// ==================================================================================
// --- 🔹 Entry point ---
// ==================================================================================
start().catch((err) => {
  console.error("❌ Failed to start WebSocket server:", err);
  process.exit(1);
});
