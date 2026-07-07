import express from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Serve static files from public directory (e.g. test.html)
  app.use(express.static(path.join(process.cwd(), "public")));

  // API Health Route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "skrim-calling-signaling" });
  });

  // WebSocket Signaling Setup
  const wss = new WebSocketServer({ noServer: true });

  // Map to track rooms: roomId -> Map of userId -> WebSocket
  const rooms = new Map<string, Map<string, WebSocket>>();

  // Map to track active client metadata: WebSocket -> { roomId, userId }
  const clients = new Map<WebSocket, { roomId: string; userId: string }>();

  wss.on("connection", (ws: WebSocket) => {
    console.log("[ws] New connection established.");

    ws.on("message", (messageData: string) => {
      try {
        const message = JSON.parse(messageData);
        const { type } = message;

        switch (type) {
          case "join": {
            const { roomId, userId } = message;
            if (!roomId || !userId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "roomId and userId are required to join.",
                })
              );
              return;
            }

            // Leave any previous room
            const existing = clients.get(ws);
            if (existing) {
              handleLeave(ws);
            }

            // Setup room mapping
            if (!rooms.has(roomId)) {
              rooms.set(roomId, new Map());
            }
            const roomMap = rooms.get(roomId)!;

            // Register socket
            roomMap.set(userId, ws);
            clients.set(ws, { roomId, userId });

            console.log(`[ws] User "${userId}" joined room "${roomId}"`);

            // Fetch current members in room (excluding the joiner)
            const members = Array.from(roomMap.keys()).filter((id) => id !== userId);

            // Confirm join to client
            ws.send(
              JSON.stringify({
                type: "joined",
                roomId,
                userId,
                members,
              })
            );

            // Notify other members
            roomMap.forEach((memberWs, memberId) => {
              if (memberId !== userId && memberWs.readyState === WebSocket.OPEN) {
                memberWs.send(
                  JSON.stringify({
                    type: "user-joined",
                    userId,
                  })
                );
              }
            });
            break;
          }

          case "leave": {
            handleLeave(ws);
            break;
          }

          case "offer":
          case "answer":
          case "ice-candidate":
          case "call-decline":
          case "hangup": {
            const clientMeta = clients.get(ws);
            if (!clientMeta) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "You must join a room first before sending signals.",
                })
              );
              return;
            }

            const { roomId, userId: senderId } = clientMeta;
            const { targetId } = message;

            const roomMap = rooms.get(roomId);
            if (!roomMap) return;

            const relayPayload = {
              ...message,
              senderId,
            };

            if (targetId) {
              // Direct signaling to a target user
              const targetWs = roomMap.get(targetId);
              if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify(relayPayload));
              }
            } else {
              // General broadcast to all other users in the room
              roomMap.forEach((memberWs, memberId) => {
                if (memberId !== senderId && memberWs.readyState === WebSocket.OPEN) {
                  memberWs.send(JSON.stringify(relayPayload));
                }
              });
            }
            break;
          }

          default: {
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Unsupported message type: ${type}`,
              })
            );
          }
        }
      } catch (err: any) {
        console.error("[ws] Error processing message:", err);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Malformed message payload.",
          })
        );
      }
    });

    ws.on("close", () => {
      console.log("[ws] Connection closed.");
      handleLeave(ws);
    });

    ws.on("error", (err) => {
      console.error("[ws] Connection error:", err);
      handleLeave(ws);
    });
  });

  function handleLeave(ws: WebSocket) {
    const clientMeta = clients.get(ws);
    if (!clientMeta) return;

    const { roomId, userId } = clientMeta;
    clients.delete(ws);

    const roomMap = rooms.get(roomId);
    if (roomMap) {
      roomMap.delete(userId);
      console.log(`[ws] User "${userId}" left room "${roomId}"`);

      // Notify remaining members
      roomMap.forEach((memberWs) => {
        if (memberWs.readyState === WebSocket.OPEN) {
          memberWs.send(
            JSON.stringify({
              type: "user-left",
              userId,
            })
          );
        }
      });

      // Clear empty room
      if (roomMap.size === 0) {
        rooms.delete(roomId);
        console.log(`[ws] Room "${roomId}" is now empty and has been removed.`);
      }
    }
  }

  // Handle server-side upgrades for Websockets at path /ws
  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url || "", `http://${request.headers.host}`);
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  // Integrate Vite dev middleware or serve static built files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[skrim-calling] Server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[skrim-calling] Server boot failure:", err);
});
