// server.ts
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import { createClient } from "redis";

// Better type definitions
interface WSMessage {
  type: string;
  userId?: string;
  [key: string]: unknown;
}

interface RedisMessage {
  userId: string;
  productId?: string;
  status?: string;
  productName?: string;
}

type WS = WebSocket & { isAlive?: boolean; userId?: string };

const server = http.createServer();
const wss = new WebSocketServer({ server });

// 🔧 allow multiple sockets per user
const clients = new Map<string, Set<WS>>();

function addClient(userId: string, ws: WS) {
  console.log(`Adding client for user: ${userId}`);
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(ws);
  ws.userId = userId;
  console.log(`Total clients for user ${userId}: ${set.size}`);
}

function removeClient(ws: WS) {
  const uid = ws.userId;
  if (!uid) return;
  console.log(`Removing client for user: ${uid}`);
  const set = clients.get(uid);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    clients.delete(uid);
    console.log(`No more clients for user: ${uid}`);
  } else {
    console.log(`Remaining clients for user ${uid}: ${set.size}`);
  }
}

function sendToUser(userId: string, payload: unknown) {
  const set = clients.get(userId);
  if (!set) {
    console.log(`No clients found for user: ${userId}`);
    return;
  }
  const data = JSON.stringify(payload);
  console.log(`Sending to user ${userId}:`, payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

wss.on("connection", (ws: WS) => {
  console.log("New WebSocket connection established");
  let registered = false;

  // 🔧 heartbeat
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(data.toString());
      console.log("Received message:", msg);
    } catch (error) {
      console.warn("Failed to parse WebSocket message:", error);
      return;
    }

    if (!registered) {
      if (msg.type === "register" && typeof msg.userId === "string") {
        console.log(`User registering: ${msg.userId}`);
        registered = true;
        addClient(msg.userId, ws);
        ws.send(JSON.stringify({ type: "registered", userId: msg.userId }));
        console.log(`User ${msg.userId} registered successfully`);
      } else {
        console.log("Invalid first message, closing connection");
        ws.close(1003, "First message must be a register message");
      }
      return;
    }

    // (handle future messages here if needed)
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    removeClient(ws);
  });
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    removeClient(ws);
    try {
      ws.terminate();
    } catch (terminateError) {
      console.error("Failed to terminate WebSocket:", terminateError);
    }
  });
});

// 🔧 heartbeat interval: keep alive and reap dead sockets
const interval = setInterval(() => {
  console.log(`Heartbeat check - Total clients: ${wss.clients.size}`);
  wss.clients.forEach((socket) => {
    const ws = socket as WS;
    if (ws.isAlive === false) {
      console.log(`Terminating dead socket for user: ${ws.userId}`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);
wss.on("close", () => clearInterval(interval));

async function startServer() {
  try {
    console.log("Starting WebSocket server...");
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();

    await pubClient.connect();
    await subClient.connect();
    console.log("Redis clients connected");

    // Add error handlers for Redis
    pubClient.on("error", (err) =>
      console.error("Redis pub client error:", err)
    );
    subClient.on("error", (err) =>
      console.error("Redis sub client error:", err)
    );

    await subClient.subscribe("new_screen_call", (message) => {
      console.log("Received new_screen_call from Redis:", message);
      try {
        const payload: RedisMessage = JSON.parse(message);
        if (!payload?.userId) return;
        sendToUser(payload.userId, {
          type: "new_screen_call",
          userId: payload.userId,
        });
      } catch (error) {
        console.error("Failed to parse new_screen_call message:", error);
      }
    });

    await subClient.subscribe("problem_done", (message) => {
      console.log("Received problem_done from Redis:", message);
      try {
        const result: RedisMessage = JSON.parse(message);
        if (!result?.userId) return;
        sendToUser(result.userId, {
          type: "problem_done",
          productId: result.productId,
          status: result.status,
          productName: result.productName,
        });
      } catch (error) {
        console.error("Failed to parse problem_done message:", error);
      }
    });

    const port = Number(process.env.PORT ?? 8080);
    server.listen(port, () => {
      console.log(`WS server listening on :${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer().catch(console.error);
