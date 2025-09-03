// server.ts
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import { createClient } from "redis";

type WS = WebSocket & { userId?: string };

const server = http.createServer();
const wss = new WebSocketServer({ server });
const clients = new Map<string, Set<WS>>();

function add(userId: string, ws: WS) {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  ws.userId = userId;
  set.add(ws);
}

function remove(ws: WS) {
  const id = ws.userId;
  if (!id) return;
  const set = clients.get(id);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clients.delete(id);
}

function send(userId: string, payload: unknown) {
  const set = clients.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

wss.on("connection", (ws: WS) => {
  let registered = false;
  ws.on("message", (data) => {
    if (registered) return;
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

async function start() {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  await redis.subscribe("new_screen_call", (message) => {
    console.log("received a new screen call event inside ws");

    try {
      const m = JSON.parse(message);
      if (m?.userId) send(m.userId, { type: "new_screen_call" });
    } catch {}
  });

  await redis.subscribe("problem_done", (message) => {
    try {
      const m = JSON.parse(message);
      if (m?.userId)
        send(m.userId, {
          type: "problem_done",
          productId: m.productId,
          status: m.status,
          productName: m.productName,
        });
    } catch {}
  });

  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => console.log(`WS listening on :${port}`));
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
