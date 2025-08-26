import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import { createClient } from "redis";
import { v4 as uuidv4 } from "uuid";

const server = http.createServer();
const wss = new WebSocketServer({ server });
const clients = new Map();

const port = parseInt(process.env.PORT || "8080");

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch (error) {
      console.error("Invalid JSON message received:", error);
      return;
    }

    if (msg.type === "register" && typeof msg.userId === "string") {
      console.log("received a register event on ws");

      clients.set(msg.userId, ws);
      ws.send(
        JSON.stringify({
          type: "registered",
          userId: msg.userId,
        })
      );
    } else {
      ws.close(1003, "First message must be a register message");
    }
  });

  ws.on("close", () => {
    for (const [uid, socket] of clients.entries()) {
      if (socket === ws) {
        clients.delete(uid);
        break;
      }
    }
  });
});

async function startServer() {
  const pubClient = createClient({
    url: process.env.REDIS_URL,
  });
  const subClient = pubClient.duplicate();
  await pubClient.connect();
  await subClient.connect();

  await subClient.subscribe("new_screen_call", (message) => {
    console.log("A new screening call was made inside ws server");
    try {
      let payload = JSON.parse(message);
      console.log("payload is ", payload);

      let userId = payload.userId;
      const ws = clients.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "new_screen_call",
            userId: userId,
          })
        );
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  await subClient.subscribe("problem_done", (message) => {
    console.log("Received message from pubsub", message);
    let result;
    try {
      result = JSON.parse(message);
      console.log("parsed result is ", result);
    } catch (error) {
      console.log(error);

      return console.error("Invalid JSON in pubsub payload:", message);
    }

    if (!result.userId) {
      console.error("Missing userId in message:", result);
      return;
    }

    const ws = clients.get(result.userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "problem_done",
          productId: result.productId,
          status: result.status,
          productName: result.productName,
        })
      );
    } else {
      console.log("Client not found or not open for userId:", result.userId);
    }
  });

  server.listen(port, () => {
    console.log("WS server listening on ws://localhost:8080");
  });
}

startServer().catch(console.error);
