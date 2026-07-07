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

  // Simple in-memory bundle registry (userId -> prekeyBundle)
  const keyBundleRegistry = new Map<string, any>();

  // Token-bucket rate-limiter per IP: max 10 requests per minute
  interface TokenBucket {
    tokens: number;
    lastRefill: number;
  }

  const rateLimitMap = new Map<string, TokenBucket>();

  const isRateLimited = (ip: string): boolean => {
    const now = Date.now();
    const limit = 10; // max requests
    const windowMs = 60000; // 1 minute in ms
    const refillRate = limit / windowMs; // tokens per ms

    let bucket = rateLimitMap.get(ip);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
    } else {
      // Refill tokens based on time elapsed
      const elapsed = now - bucket.lastRefill;
      const addedTokens = elapsed * refillRate;
      bucket.tokens = Math.min(limit, bucket.tokens + addedTokens);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      rateLimitMap.set(ip, bucket);
      return false; // Not rate limited
    }

    rateLimitMap.set(ip, bucket);
    return true; // Rate limited!
  };

  const rateLimiterMiddleware = (req: any, res: any, next: any) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "anonymous";
    const clientIp = typeof ip === "string" ? ip.split(",")[0].trim() : "anonymous";

    if (isRateLimited(clientIp)) {
      res.status(429).json({
        success: false,
        error: "Too many requests. Rate limit is 10 requests per minute.",
      });
      return;
    }
    next();
  };

  // POST /register-key endpoint to register a user's client-generated public key (rate-limited)
  app.post("/register-key", rateLimiterMiddleware, (req, res) => {
    const { userId, publicKey } = req.body;
    if (!userId || !publicKey) {
      res.status(400).json({ success: false, error: "Missing userId or publicKey in request body" });
      return;
    }
    publicKeyRegistry.set(userId, publicKey);
    console.log(`[Key Registry] Registered public key for "${userId}"`);
    res.json({ success: true, message: `Public key for '${userId}' registered successfully` });
  });

  // POST /keys/bundle endpoint to register a user's full prekey bundle (rate-limited)
  app.post("/keys/bundle", rateLimiterMiddleware, (req, res) => {
    const { userId, bundle } = req.body;
    if (!userId || !bundle) {
      res.status(400).json({ success: false, error: "Missing userId or bundle in request body" });
      return;
    }
    keyBundleRegistry.set(userId, bundle);
    console.log(`[Bundle Registry] Registered prekey bundle for "${userId}"`);
    res.json({ success: true, message: `Prekey bundle for '${userId}' registered successfully` });
  });

  // GET /keys/bundle/:userId endpoint to retrieve a user's prekey bundle
  app.get("/keys/bundle/:userId", (req, res) => {
    const { userId } = req.params;
    const bundle = keyBundleRegistry.get(userId);
    if (!bundle) {
      res.status(404).json({ success: false, error: `Prekey bundle not found for user '${userId}'` });
      return;
    }
    res.json({ userId, bundle });
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

  // Map of userId -> last signaling message sequence number to prevent replay attacks
  const lastSequenceMap = new Map<string, number>();

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
            const { roomId, userId, role, token } = message;
            if (!roomId || !userId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "roomId and userId are required to join.",
                })
              );
              return;
            }

            // Require every WebSocket connection to send a valid auth token.
            // For now, we accept any non-empty string in the "token" field.
            // TODO: In a production system, you would verify this token against your real backend auth
            // (e.g. Firebase Auth ID Token verification, database session validation, OAuth2 token verify, JWT, etc.)
            // Example implementation with Firebase Admin SDK:
            // try {
            //   const decodedToken = await admin.auth().verifyIdToken(token);
            //   if (decodedToken.uid !== userId) {
            //     throw new Error("Token UID does not match local userId");
            //   }
            // } catch (err) {
            //   ws.send(JSON.stringify({ type: "error", message: "Invalid or expired auth token." }));
            //   ws.close();
            //   return;
            // }
            if (!token || typeof token !== "string" || !token.trim()) {
              console.log(`[ws] Rejected join request from user "${userId}" in room "${roomId}": Missing or invalid auth token`);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Authentication token is required to join.",
                })
              );
              ws.close();
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
            const { targetId, seq, timestamp } = message;

            // 1. Validate sequence number (anti-replay check)
            const lastSeq = lastSequenceMap.get(senderId) || 0;
            if (typeof seq !== "number" || seq <= lastSeq) {
              console.log(`[ws] [REPLAY ATTACK PREVENTED] Dropped signaling message of type "${type}" from ${senderId}: sequence number (${seq}) must be greater than last seen (${lastSeq})`);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Invalid or duplicate sequence number. Signaling message dropped.",
                })
              );
              return;
            }

            // 2. Validate timestamp (expiration window of 30 seconds to prevent replayed old signals)
            if (!timestamp || typeof timestamp !== "string") {
              console.log(`[ws] [REPLAY ATTACK PREVENTED] Dropped signaling message of type "${type}" from ${senderId}: missing or invalid timestamp`);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Message timestamp is required.",
                })
              );
              return;
            }
            const msgTime = new Date(timestamp).getTime();
            if (isNaN(msgTime)) {
              console.log(`[ws] [REPLAY ATTACK PREVENTED] Dropped signaling message of type "${type}" from ${senderId}: invalid timestamp format "${timestamp}"`);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Invalid timestamp format.",
                })
              );
              return;
            }
            const ageMs = Date.now() - msgTime;
            if (Math.abs(ageMs) > 30000) {
              console.log(`[ws] [REPLAY ATTACK PREVENTED] Dropped signaling message of type "${type}" from ${senderId}: message timestamp has expired or has skew > 30s (message age: ${ageMs / 1000}s, limit: 30s)`);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Message timestamp has expired or exceeds 30-second clock skew limit.",
                })
              );
              return;
            }

            // Update sender's last seen sequence number
            lastSequenceMap.set(senderId, seq);

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
    lastSequenceMap.delete(userId); // Clear sequence history for user on disconnect

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
