// NOTE: This server.ts file will be upgraded in a later phase to integrate with the standalone Secure Communication Library.
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

  // Enable JSON body parsing for API requests
  app.use(express.json());

  // Simple in-memory key registry (userId -> publicKeyBase64)
  const publicKeyRegistry = new Map<string, string>();

  // POST /register-key endpoint to register a user's client-generated public key
  app.post("/register-key", (req, res) => {
    const { userId, publicKey } = req.body;
    if (!userId || !publicKey) {
      res.status(400).json({ success: false, error: "Missing userId or publicKey in request body" });
      return;
    }
    publicKeyRegistry.set(userId, publicKey);
    console.log(`[Key Registry] Registered public key for "${userId}"`);
    res.json({ success: true, message: `Public key for '${userId}' registered successfully` });
  });

  // GET /key/:userId endpoint to retrieve a user's registered public key
  app.get("/key/:userId", (req, res) => {
    const { userId } = req.params;
    const publicKey = publicKeyRegistry.get(userId);
    if (!publicKey) {
      res.status(404).json({ success: false, error: `Public key not found for user '${userId}'` });
      return;
    }
    res.json({ userId, publicKey });
  });

  // API Health Route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "skrim-calling-signaling", registeredKeysCount: publicKeyRegistry.size });
  });

  // WebSocket Signaling Setup
  const wss = new WebSocketServer({ noServer: true });

  // Map to track rooms: roomId -> Map of userId -> WebSocket
  const rooms = new Map<string, Map<string, WebSocket>>();

  // Map to track active client metadata: WebSocket -> { roomId, userId, role }
  const clients = new Map<WebSocket, { roomId: string; userId: string; role?: string }>();

  // Broadcast viewer count to all room members
  function broadcastViewerCount(roomId: string) {
    const roomMap = rooms.get(roomId);
    if (!roomMap) return;
    let count = 0;
    roomMap.forEach((memberWs) => {
      const meta = clients.get(memberWs);
      if (meta && meta.role === "viewer") {
        count++;
      }
    });
    roomMap.forEach((memberWs) => {
      if (memberWs.readyState === WebSocket.OPEN) {
        memberWs.send(JSON.stringify({
          type: "live-viewer-count-update",
          count
        }));
      }
    });
  }



  wss.on("connection", (ws: WebSocket) => {
    console.log("[ws] New connection established.");

    ws.on("message", (messageData: string) => {
      try {
        const message = JSON.parse(messageData);
        const { type } = message;

        switch (type) {
          case "join": {
            const { roomId, userId, role } = message;
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
            clients.set(ws, { roomId, userId, role: role || "normal" });

            console.log(`[ws] User "${userId}" joined room "${roomId}" with role "${role || "normal"}"`);

            // Fetch current members in room (excluding the joiner)
            const members = Array.from(roomMap.keys()).filter((id) => id !== userId);

            // Confirm join to client
            ws.send(
              JSON.stringify({
                type: "joined",
                roomId,
                userId,
                role: role || "normal",
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
                    role: role || "normal",
                  })
                );
              }
            });

            // Broadcast viewer count to all members in the room
            broadcastViewerCount(roomId);
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

          case "live-chat-message": {
            const clientMeta = clients.get(ws);
            if (clientMeta) {
              const { roomId, userId } = clientMeta;
              const { text } = message;
              const roomMap = rooms.get(roomId);
              if (roomMap) {
                roomMap.forEach((memberWs) => {
                  if (memberWs.readyState === WebSocket.OPEN) {
                    memberWs.send(JSON.stringify({
                      type: "live-chat-message",
                      userId,
                      text,
                      timestamp: new Date().toISOString()
                    }));
                  }
                });
              }
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

      // Broadcast viewer count to all members remaining in the room
      broadcastViewerCount(roomId);

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
