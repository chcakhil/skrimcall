# skrim-calling 📞

`skrim-calling` is a highly scalable, lightweight, and robust WebRTC signaling server and testing toolkit designed to coordinate peer-to-peer audio/video calling.

It implements a clean, room-based WebSocket signaling model to register users and exchange Session Description Protocol (SDP) signals (`offer`, `answer`) and Interactive Connectivity Establishment (`ice-candidate`) parameters.

---

## 🛠 Features

1. **Room-Based Isolation**: Clients can join any room ID to connect with other peers instantly.
2. **Standard WebRTC Signaling**: Complete protocol support for matching, offerings, responses, and candidate negotiation.
3. **No-Authentication Phase**: Ready for developers to inspect, test, and integrate immediately.
4. **Interactive Dashboard**: Features a rich React-based dashboard console plus a dedicated standalone plain HTML/JS testing page (`/test.html`).
5. **Coturn Integration**: Comes pre-configured with a standard STUN/TURN Docker Compose blueprint to ease local network traversal testing.

---

## 🚀 Quick Start (Local Run)

Follow these simple steps to spin up and test `skrim-calling` locally:

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
Launch the unified Express development server:
```bash
npm run dev
```
The server will boot on `http://localhost:3000` with live reload.

### 3. Open the Testing Panel
To verify message relaying:
1. Open **two separate browser windows/tabs** to `http://localhost:3000/test.html` (or use the built-in React dashboard console on the homepage).
2. For Tab 1, enter a room ID (e.g., `skrim-test-room`), a custom User ID (e.g., `Alice`), and click **Join Room**.
3. For Tab 2, enter the *same* room ID (`skrim-test-room`), a different User ID (e.g., `Bob`), and click **Join Room**.
4. Both tabs will log `joined` state and list the other user in the "Room Directory".
5. Use the **Manual Signal Testing** box to send mock `Offer`, `Answer`, and `ICE` parameters, and observe the live color-coded JSON logs arriving in real-time in the other peer's terminal log!

---

## 📡 WebSocket Signaling Protocol Specification

All communication occurs via JSON frames over the WebSocket protocol at `/ws`. Below are the schemas and message flows:

### 1. Join Room (`join`)
Sent by a client to join or create a session room.
```json
{
  "type": "join",
  "roomId": "test-room",
  "userId": "peer-alice"
}
```

### 2. Joined Success Response (`joined`)
Sent by the server back to the joining client. Includes a listing of all other active peer IDs in the room.
```json
{
  "type": "joined",
  "roomId": "test-room",
  "userId": "peer-alice",
  "members": ["peer-bob", "peer-charlie"]
}
```

### 3. Peer Join Alert (`user-joined`)
Broadcast by the server to all other peers in the room when a new peer connects.
```json
{
  "type": "user-joined",
  "userId": "peer-alice"
}
```

### 4. Signaling Relay (`offer`, `answer`, `ice-candidate`)
Used by peers during the WebRTC handshake. If a `targetId` is specified, the message is routed directly to that user. If `targetId` is absent, it is broadcast to all other peers in the room.

#### SDP Offer
```json
{
  "type": "offer",
  "roomId": "test-room",
  "targetId": "peer-bob",
  "sdp": {
    "type": "offer",
    "sdp": "v=0\r\no=-..."
  }
}
```

#### SDP Answer
```json
{
  "type": "answer",
  "roomId": "test-room",
  "targetId": "peer-alice",
  "sdp": {
    "type": "answer",
    "sdp": "v=0\r\no=-..."
  }
}
```

#### ICE Candidate
```json
{
  "type": "ice-candidate",
  "roomId": "test-room",
  "targetId": "peer-bob",
  "candidate": {
    "candidate": "candidate:84216...",
    "sdpMid": "audio",
    "sdpMLineIndex": 0
  }
}
```

### 5. Leave Room / Disconnect
Sent by a client to clean up state or when the socket closes.
```json
{
  "type": "leave"
}
```
*Note: Upon receiving this or upon hard socket disconnects, the server automatically broadcasts a `{"type": "user-left", "userId": "..."}` to other members.*

---

## 🛡 Network Traversal: Local Coturn STUN/TURN Setup

WebRTC connections between distinct networks require STUN/TURN servers to find public routes (ICE candidates) and bypass symmetric NAT restrictions.

### 1. Launch Coturn
Start the local coturn docker container in the background:
```bash
docker-compose up -d
```

This runs:
- **STUN/TURN** listener on ports `3478` (UDP/TCP)
- **Long-term credential mechanism** with authentication enabled
- **Verbose mode (`-v`)** to view active connection negotiations

### 2. Local TURN Credentials
- **Username**: `skrimuser`
- **Password**: `skrimpassword`
- **Realm**: `skrimcalling.local`

### 3. Integrating with WebRTC Client JS
To use this server in your frontend application, configure the `RTCPeerConnection` with the STUN and TURN configurations as shown below:

```javascript
const configuration = {
  iceServers: [
    // Public STUN server (useful for finding public IP address)
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    // Your local STUN server running on Coturn
    {
      urls: 'stun:localhost:3478'
    },
    // Your local TURN server running on Coturn with credentials
    {
      urls: 'turn:localhost:3478',
      username: 'skrimuser',
      credential: 'skrimpassword'
    }
  ],
  iceTransportPolicy: 'all' // Can change to 'relay' to force TURN traffic testing
};

// Create the peer connection instance
const peerConnection = new RTCPeerConnection(configuration);
```

### 4. Stopping Coturn
```bash
docker-compose down
```
