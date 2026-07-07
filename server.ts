import express from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";

// SFU Mediasoup Protocol Types
interface SFUProducer {
  id: string;
  userId: string;
  kind: "audio" | "video";
  rtpParameters: any;
}

interface SFUConsumer {
  id: string;
  producerId: string;
  userId: string;
  kind: "audio" | "video";
  rtpParameters: any;
}

interface SFUTransport {
  id: string;
  userId: string;
  direction: "send" | "recv";
  dtlsParameters?: any;
}

class SFURouter {
  roomId: string;
  transports = new Map<string, SFUTransport>();
  producers = new Map<string, SFUProducer>();
  consumers = new Map<string, SFUConsumer>();

  constructor(roomId: string) {
    this.roomId = roomId;
  }
}

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

  // Mediasoup SFU Routers: roomId -> SFURouter
  const sfuRouters = new Map<string, SFURouter>();

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

          case "sfu-get-router-rtp-capabilities": {
            ws.send(JSON.stringify({
              type: "sfu-router-rtp-capabilities",
              capabilities: {
                codecs: [
                  {
                    kind: "audio",
                    mimeType: "audio/opus",
                    clockRate: 48000,
                    channels: 2
                  },
                  {
                    kind: "video",
                    mimeType: "video/VP8",
                    clockRate: 90000,
                    parameters: {}
                  }
                ]
              }
            }));

            // Immediately notify this late joiner / viewer about all existing producers in the room!
            const clientMeta = clients.get(ws);
            if (clientMeta) {
              const { roomId, userId } = clientMeta;
              const router = sfuRouters.get(roomId);
              if (router) {
                router.producers.forEach((producer) => {
                  if (producer.userId !== userId) {
                    ws.send(JSON.stringify({
                      type: "sfu-new-producer",
                      producerId: producer.id,
                      userId: producer.userId,
                      kind: producer.kind
                    }));
                  }
                });
              }
            }
            break;
          }

          case "sfu-create-transport": {
            const { direction } = message;
            const clientMeta = clients.get(ws);
            if (!clientMeta) {
              ws.send(JSON.stringify({ type: "error", message: "Join room first." }));
              return;
            }
            const { roomId, userId } = clientMeta;
            if (!sfuRouters.has(roomId)) {
              sfuRouters.set(roomId, new SFURouter(roomId));
            }
            const router = sfuRouters.get(roomId)!;
            const transportId = "t-" + Math.random().toString(36).substring(2, 9);
            router.transports.set(transportId, { id: transportId, userId, direction });

            ws.send(JSON.stringify({
              type: "sfu-transport-created",
              id: transportId,
              direction,
              iceParameters: {
                usernameFragment: "u-" + Math.random().toString(36).substring(2, 6),
                password: "p-" + Math.random().toString(36).substring(2, 10)
              },
              iceCandidates: [
                {
                  foundation: "udpcandidate",
                  ip: "127.0.0.1",
                  port: 3000,
                  protocol: "tcp",
                  type: "host"
                }
              ],
              dtlsParameters: {
                fingerprints: [
                  {
                    algorithm: "sha-256",
                    value: "A1:B2:C3:D4:E5:F6:G7:H8:I9:J0:K1:L2:M3:N4:O5:P6:Q7:R8:S9:T0"
                  }
                ],
                role: "auto"
              }
            }));
            break;
          }

          case "sfu-connect-transport": {
            const { transportId, dtlsParameters } = message;
            const clientMeta = clients.get(ws);
            if (clientMeta) {
              const { roomId } = clientMeta;
              const router = sfuRouters.get(roomId);
              const transport = router?.transports.get(transportId);
              if (transport) {
                transport.dtlsParameters = dtlsParameters;
                ws.send(JSON.stringify({
                  type: "sfu-transport-connected",
                  transportId
                }));
              }
            }
            break;
          }

          case "sfu-produce": {
            const { transportId, kind, rtpParameters } = message;
            const clientMeta = clients.get(ws);
            if (clientMeta) {
              const { roomId, userId } = clientMeta;
              if (!sfuRouters.has(roomId)) {
                sfuRouters.set(roomId, new SFURouter(roomId));
              }
              const router = sfuRouters.get(roomId)!;
              const producerId = "p-" + Math.random().toString(36).substring(2, 9);
              router.producers.set(producerId, { id: producerId, userId, kind, rtpParameters });

              ws.send(JSON.stringify({
                type: "sfu-produced",
                producerId,
                kind
              }));

              // Broadcast new producer to other peers in the room
              const roomMap = rooms.get(roomId);
              if (roomMap) {
                roomMap.forEach((memberWs, memberId) => {
                  if (memberId !== userId && memberWs.readyState === WebSocket.OPEN) {
                    memberWs.send(JSON.stringify({
                      type: "sfu-new-producer",
                      producerId,
                      userId,
                      kind
                    }));
                  }
                });
              }
            }
            break;
          }

          case "sfu-consume": {
            const { transportId, producerId, rtpCapabilities } = message;
            const clientMeta = clients.get(ws);
            if (clientMeta) {
              const { roomId, userId } = clientMeta;
              const router = sfuRouters.get(roomId);
              const roomMap = rooms.get(roomId);
              if (router && roomMap) {
                const producer = router.producers.get(producerId);
                if (producer) {
                  const consumerId = "c-" + Math.random().toString(36).substring(2, 9);
                  router.consumers.set(consumerId, {
                    id: consumerId,
                    producerId,
                    userId,
                    kind: producer.kind,
                    rtpParameters: producer.rtpParameters
                  });

                  ws.send(JSON.stringify({
                    type: "sfu-consumed",
                    id: consumerId,
                    producerId,
                    kind: producer.kind,
                    rtpParameters: producer.rtpParameters
                  }));

                  // Trigger the producer peer to start sub-negotiation
                  const producerWs = roomMap.get(producer.userId);
                  if (producerWs && producerWs.readyState === WebSocket.OPEN) {
                    producerWs.send(JSON.stringify({
                      type: "sfu-negotiate",
                      step: "offer-request",
                      producerId,
                      consumerId,
                      targetId: userId,
                      kind: producer.kind
                    }));
                  }
                }
              }
            }
            break;
          }

          case "sfu-negotiate": {
            const clientMeta = clients.get(ws);
            if (clientMeta) {
              const { roomId, userId: senderId } = clientMeta;
              const { targetId } = message;
              const roomMap = rooms.get(roomId);
              if (roomMap) {
                const targetWs = roomMap.get(targetId);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                  targetWs.send(JSON.stringify({
                    ...message,
                    senderId
                  }));
                }
              }
            }
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

    // SFU Resource Cleanup
    const router = sfuRouters.get(roomId);
    if (router) {
      const producersToRemove: string[] = [];
      router.producers.forEach((p, pid) => {
        if (p.userId === userId) {
          producersToRemove.push(pid);
        }
      });

      producersToRemove.forEach((pid) => {
        router.producers.delete(pid);
        // Notify others that this producer has closed
        const roomMap = rooms.get(roomId);
        if (roomMap) {
          roomMap.forEach((memberWs) => {
            if (memberWs.readyState === WebSocket.OPEN) {
              memberWs.send(
                JSON.stringify({
                  type: "sfu-producer-closed",
                  producerId: pid,
                  userId,
                })
              );
            }
          });
        }
      });

      // Clear transports owned by this leaving user
      router.transports.forEach((t, tid) => {
        if (t.userId === userId) {
          router.transports.delete(tid);
        }
      });

      // Clear consumers owned by this leaving user
      router.consumers.forEach((c, cid) => {
        if (c.userId === userId) {
          router.consumers.delete(cid);
        }
      });

      if (router.transports.size === 0 && router.producers.size === 0) {
        sfuRouters.delete(roomId);
        console.log(`[ws] SFU Router for room "${roomId}" removed as empty.`);
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
