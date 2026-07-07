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

### 3. Open the Testing Panel & Make Live 1:1 Audio Calls
To verify message relaying and live WebRTC audio calling:
1. Open **two separate browser windows/tabs** to `http://localhost:3000/test.html` (or use the built-in React dashboard console on the homepage).
2. For Tab 1, enter a room ID (e.g., `skrim-test-room`), a custom User ID (e.g., `Alice`), and click **Join Room**.
3. For Tab 2, enter the *same* room ID (`skrim-test-room`), a different User ID (e.g., `Bob`), and click **Join Room**.
4. Both tabs will log `joined` state and list the other user in the "Room Directory".
5. In **Tab 1**, select **Bob** from the **Target Peer to Call** dropdown in the *3. Live 1:1 Audio Call* card and click **Start Audio Call**.
6. **Tab 2** will immediately ring, prompting an incoming call notification card from `Alice`.
7. Click **Accept** in Tab 2 to grant microphone permissions (`getUserMedia`) and establish a real WebRTC peer-to-peer audio connection!
8. Track the real-time WebRTC PC Connection State, ICE Connection State, and Signaling State directly from the status card.
9. Use the **Mute Mic** toggle to silence your audio locally, or click **End Call** on either device to gracefully close the RTCPeerConnection and release media tracks.
10. **Testing on Local WiFi**: Open `http://<your-machine-ip>:3000/test.html` on two different devices (e.g., your laptop and phone) connected to the same WiFi network to test real WebRTC traversal across different physical devices! The ICE configuration dynamically maps CoTurn stun/turn configurations to your host IP automatically.

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

### 5. Call Control & Rejections (`call-decline`, `hangup`)
Used to coordinate call-level permissions before WebRTC peer-connection handshakes occur.

#### Call Decline / Busy Reject
```json
{
  "type": "call-decline",
  "roomId": "test-room",
  "targetId": "peer-alice",
  "reason": "declined" // or "busy"
}
```

#### Hangup / Close Connection
```json
{
  "type": "hangup",
  "roomId": "test-room",
  "targetId": "peer-bob"
}
```

### 6. Leave Room / Disconnect
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

---

## 📹 Phase 3: Live 1:1 Video Calling & Dynamic Fallbacks Addendum

The theater of operations has been upgraded with complete video streaming support (`getUserMedia` audio + video tracks), camera hardware switching, and dynamic bandwidth-quality adaptation.

### 1. Dual-Track Media Stream Acquisition
When starting or accepting a call, `getUserMedia({ audio: true, video: true })` requests both inputs. If permission is granted:
- The local selfie feed is rendered with a natural mirror-view transform (`scaleX(-1)`) and programmatically muted to avoid recursive microphone acoustic feedback loops.
- Camera hardware devices are queried dynamically using `navigator.mediaDevices.enumerateDevices()`.

### 2. Multi-Camera / Switch Camera Support
If multiple video-capture sources are found (e.g. integrated webcam + external USB webcam, or front + back cameras on mobile phones):
- An **Active Camera Device** drop-down selector is populated.
- When changed, the client captures the new device's track and seamlessly calls `videoSender.replaceTrack()` on the active WebRTC connection, allowing camera changes in real-time without session drops or signaling negotiations!

### 3. Graceful Bandwidth & Quality Fallback
To keep calls stable over weak network topologies:
- An automated connection health monitor runs every 3 seconds while the connection state is `connected`.
- It evaluates the receiver's packets and round-trip times via `RTCPeerConnection.getStats()`.
- If packet loss exceeds **20%** or network latency (RTT) spikes above **800ms**, the client gracefully demotes the call to **Audio-Only**:
  - The local video track `enabled` property is flipped to `false` to conserve bandwidth.
  - A beautiful, non-obtrusive **Network Quality Degraded** warning overlay is presented on the video boxes, letting both peers continue their call smoothly via high-fidelity audio without freezing the pipeline.

### 4. Step-by-Step Testing Guide

#### Scenario A: Two Local Tabs (Single Machine)
1. Open two browser tabs side-by-side to `http://localhost:3000/test.html`.
2. Connect both tabs to the same Room ID (e.g., `skrim-video-room`).
3. Click **Start Video Call** in Tab 1. Tab 2 will ring instantly.
4. Click **Accept** in Tab 2.
5. Watch as the local video displays your webcam mirrored on the left and the other peer's camera feed on the right!
6. Click **Mute Mic** to silence audio, select a different webcam from the dropdown, or click **End Call** to gracefully close all active tracks.

#### Scenario B: Two Real Devices on LAN (e.g., Laptop & Phone)
1. Ensure both devices are connected to the same Local Area Network (WiFi).
2. Find the local LAN IP address of your host machine (e.g. `192.168.1.100`).
3. Open `http://<your-machine-ip>:3000/test.html` on both your Laptop and Phone.
4. Join the same Room ID on both devices.
5. Click **Start Video Call** from one of the devices.
6. Click **Accept** on the other device and grant microphone/camera permissions.
7. Observe true cross-device peer-to-peer audio and video stream delivery across physical hardware! If using your phone, use the **Active Camera Device** switcher to swap between front selfie-views and back main cameras.

---

## 🛡️ End-to-End Cryptographic Message Encryption (libsodium-wrappers)

We have built a client-side End-to-End Message Encryption (E2EE) suite using **libsodium** (via the `libsodium-wrappers` npm package) supporting secure asymmetric cryptographic operations. This module is designed to ensure that user communications remain strictly confidential, where only the intended recipient can read the message.

### 🔑 Cryptographic Architecture

1. **Client-Side Key Generation ("Signup")**:
   - Clients generate a Curve25519 public/private keypair client-side in the browser using libsodium's `crypto_box_keypair()`.
   - **Zero-Knowledge Privacy**: The private key is retained strictly in the client's transient in-memory state; it is never transmitted to the server or saved to persistent logs.

2. **Server-Side Key-Distribution Directory**:
   - A simple in-memory public-key infrastructure (PKI) registry is mounted on the Express server with two REST endpoints:
     - `POST /register-key`: Registers a user handle with their client-generated Base64-encoded public key.
     - `GET /key/:userId`: Resolves a given user handle to retrieve their registered public key.

3. **Asymmetric Box Encryption**:
   - `encryptMessage(plaintext, recipientPublicKey, senderPrivateKey)`:
     - Generates a cryptographically secure, random 24-byte nonce using `randombytes_buf()`.
     - Encrypts the plaintext using libsodium's `crypto_box_easy()`.
     - Prepends the 24-byte nonce to the encrypted payload to produce a combined buffer: `[nonce (24 bytes)][ciphertext]`.
     - Converts the combined buffer into a single compact Base64 string for delivery.
   - `decryptMessage(combinedBase64, senderPublicKey, recipientPrivateKey)`:
     - Parses the combined Base64 ciphertext.
     - Splits the first 24 bytes as the unique message nonce, and the remaining bytes as the encrypted payload.
     - Decrypts and authenticates the message using `crypto_box_open_easy()`.
     - Converts the decrypted bytes back to the original UTF-8 string.

4. **Fail-Closed Guarantee**:
   - If an unauthorized party tries to decrypt the ciphertext (e.g., using the wrong private key), or if someone tampers with the sender's public key or ciphertext, libsodium will fail authentication.
   - The library catches any failure and throws a clear, handled error: `"Decryption failed: invalid keys or corrupted ciphertext"`. No garbage data or corrupted characters are ever leaked to the UI or logs.

---

### 💻 Key Registry API Specification

#### 1. Register Public Key
* **Endpoint**: `POST /register-key`
* **Content-Type**: `application/json`
* **Payload**:
```json
{
  "userId": "Alice",
  "publicKey": "base64EncodedPublicKeyString..."
}
```
* **Response (Success)**:
```json
{
  "success": true,
  "message": "Public key for 'Alice' registered successfully"
}
```

#### 2. Retrieve Public Key
* **Endpoint**: `GET /key/:userId`
* **Response (Success)**:
```json
{
  "userId": "Alice",
  "publicKey": "base64EncodedPublicKeyString..."
}
```
* **Response (Error - User Not Found)**:
```json
{
  "success": false,
  "error": "Public key not found for user 'Alice'"
}
```

---

### 🧪 Automated Unit Testing

We have included a full suite of automated unit tests covering the E2EE capabilities, implemented using **Vitest**.

#### Test Scope:
1. **Key Generation**: Validates that client-generated keys are non-empty, valid Base64 encoded strings.
2. **Happy Path E2EE**: Simulates Alice encrypting a message for Bob, Bob resolving Alice's key and successfully decrypting it to verify the exact plaintext matches.
3. **Ciphertext Security**: Assures that the human-readable plaintext is never stored or visible in plain view within the base64 ciphertext.
4. **Wrong Recipient Fail-Closed**: Verifies that Charlie (intruder) trying to decrypt Alice's message with Charlie's private key fails immediately and throws an explicit `Decryption failed` error.
5. **Spoofed Sender Fail-Closed**: Verifies that if Bob tries to decrypt Alice's message but uses Charlie's spoofed public key instead of Alice's public key, the authentication check fails and throws a decryption error.

#### To Run the Tests:
Run the following command in your terminal:
```bash
npm run test
```
The Vitest test engine will run the tests in single-run mode and log the results:
```text
 RUN  v4.1.10 /app/applet
 ✓ src/lib/encryption.test.ts (5 tests) 23ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

---

### 🖥️ Manual Browser Testing & Playground

To test the E2EE suite interactively in the browser:

1. Start your local environment (`npm run dev`) and open the main portal.
2. Ensure the **libsodium E2E Encryption** tab is active in the top navbar.
3. **One-Click Simulator**:
   - In the left sidebar under **Instant 3-User Simulator**, click **Run Full Simulation**.
   - This triggers an automated sequence that creates three users (Ann, Bob, Charlie) client-side, registers them with the server APIs, encrypts a message from Ann to Bob, decrypts it on Bob's panel (success), and tests Charlie trying to decrypt (fail-closed check).
   - Full logs of this lifecycle will scroll in real-time in the **Cryptographic Operation Logs** console!
4. **Manual Multi-Tab Testing**:
   - Open two browser tabs side-by-side to `http://localhost:3000`.
   - **Tab 1 ("Alice")**:
     - Type `Alice` in the handle, click **Gen Keys**, then click **Register Alice's Key**.
   - **Tab 2 ("Bob")**:
     - Type `Bob` in the handle, click **Gen Keys**, then click **Register Bob's Key**.
   - **In Tab 1 ("Alice")**:
     - Under *Recipient Public Key Lookup*, type `Bob` and click **Lookup**. This will fetch Bob's public key from the Express API and populate the encryptor form.
     - Type a private message, and click **Encrypt Message**.
     - Copy the produced **Last Encrypted Ciphertext** Base64 string.
   - **In Tab 2 ("Bob")**:
     - Paste Alice's ciphertext into the **Target Ciphertext** box of the decryptor.
     - Paste Alice's Public Key (can be queried via lookup on `Alice` first) into the **Sender Public Key** box.
     - Click **Decrypt E2E** to see Alice's original message restored in perfect clarity!
     - Click **Test Fail-Closed** to see Bob's decryption instantly block and enter secure fail-closed state when an invalid/unauthorized key is supplied!

