/**
 * ============================================================================
 *                 MANUAL TEST CHECKLIST: WebRTC 1:1 CALLING
 * ============================================================================
 * 
 * 1. PREREQUISITES & SETUP:
 *    - Start the signaling server locally: `npm run dev`
 *    - Boot the coturn (STUN/TURN) background services: `docker-compose up -d`
 *    - Ensure your browser permits camera/microphone access.
 *    - Open two browser tabs:
 *      - Tab A (Local UI): `http://localhost:3000/` (Signaling Console tab)
 *      - Tab B (Standalone Client): `http://localhost:3000/test.html`
 * 
 * 2. ROOM ENTRY & DISCOVERY:
 *    - In Tab A, specify a Room ID (e.g. "secure-room") and click "Join Room". 
 *      Note your assigned peer User ID (e.g., "react-peer-1234").
 *    - In Tab B, enter the exact same Room ID "secure-room" and click "Join Room".
 *    - Check the "Active Room Members" directories in both tabs. Verify that 
 *      each tab correctly discovers the other's user ID.
 * 
 * 3. TRIGGERING CALL HANDSHAKES:
 *    - In Tab A, choose Tab B's peer ID from the "Target Peer to Call" select box, 
 *      then click "Start Video Call".
 *    - Observe the generated logs. Verify the creation of a local RTCPeerConnection,
 *      acquisition of local camera/mic stream, generation of a real SDP Offer,
 *      and relaying of the "offer" payload over WebSocket signaling.
 *    - Verify that Tab B transitions to "RINGING" and displays the incoming call 
 *      Accept/Decline overlay with the proper caller ID.
 * 
 * 4. CALL ACCEPTANCE & REAL-TIME STREAMING:
 *    - In Tab B, click "Accept". Grant permissions in the browser prompt.
 *    - Verify that Tab B generates a real SDP Answer, applies the remote offer description,
 *      sets up ICE candidate exchanges, and relays the "answer" payload.
 *    - Verify that BOTH tabs transition to "CONNECTED".
 *    - Verify that local and remote video elements display active live-streamed camera streams.
 *    - Verify that ICE Connection and RTCPeerConnection states show "CONNECTED" / "COMPLETED".
 * 
 * 5. STREAM MANIPULATIONS & NETWORK FALLBACKS:
 *    - Click "Mute Mic" in Tab A. Verify that the local audio track is disabled and logs confirm.
 *    - Click "Toggle Camera" in Tab B. Verify that the video is paused/cleared.
 *    - (Optional) Simulate network degradation. Confirm that the Stats Monitor 
 *      detects high RTT (>800ms) or packet loss (>20%) and demotes to Audio-Only fallback.
 * 
 * 6. CALL TEARDOWN:
 *    - Click "End Call" in either Tab A or Tab B.
 *    - Verify that both clients send/receive the "hangup" message, tear down their 
 *      respective peer connections, stop all media tracks, clear the video elements,
 *      and gracefully return to the "IDLE" state.
 * ============================================================================
 */

export interface CallConfig {
  iceServers?: RTCIceServer[];
  audio: boolean;
  video: boolean;
}

export interface CallCallbacks {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onCallStateChange?: (state: 'idle' | 'acquiring' | 'calling' | 'ringing' | 'connected' | 'ended') => void;
  onSignalingMessage?: (msg: any) => void;
  onConnStateChange?: (state: RTCPeerConnectionState) => void;
  onIceStateChange?: (state: RTCIceConnectionState) => void;
  onSigStateChange?: (state: RTCSignalingState) => void;
  onLog?: (direction: 'in' | 'out' | 'sys', type: string, payload: any) => void;
}

/**
 * Parses TURN server details from an env-configurable list for NAT traversal fallback
 * or returns standard defaults including local coturn and Google STUN.
 */
export function getIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [
    {
      urls: 'stun:stun.l.google.com:19302'
    }
  ];

  try {
    // Read turn server details from an env-configurable list
    const envTurn = (import.meta as any).env?.VITE_TURN_SERVERS;
    if (envTurn) {
      const parsed = JSON.parse(envTurn);
      if (Array.isArray(parsed)) {
        iceServers.push(...parsed);
      }
    } else {
      // Sensible defaults matching CoTurn in local docker-compose
      const currentHost = typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1';
      iceServers.push({
        urls: `stun:${currentHost}:3478`
      });
      iceServers.push({
        urls: `turn:${currentHost}:3478`,
        username: 'skrimuser',
        credential: 'skrimpassword'
      });
    }
  } catch (e) {
    console.warn("Failed to parse VITE_TURN_SERVERS environment variable, using fallback", e);
    const currentHost = typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1';
    iceServers.push({
      urls: `stun:${currentHost}:3478`
    });
    iceServers.push({
      urls: `turn:${currentHost}:3478`,
      username: 'skrimuser',
      credential: 'skrimpassword'
    });
  }

  return iceServers;
}

export class CallManager {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private currentCallPeer: string | null = null;
  private roomId: string = "";
  private userId: string = "";
  private isCaller: boolean = false;
  private isMuted: boolean = false;
  private isCameraOff: boolean = false;
  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private statsInterval: any = null;

  public callbacks: CallCallbacks = {};

  constructor(userId?: string, roomId?: string) {
    if (userId) this.userId = userId;
    if (roomId) this.roomId = roomId;
  }

  /**
   * Sets the current client identity and active room context
   */
  public setIdentity(userId: string, roomId: string): void {
    this.userId = userId;
    this.roomId = roomId;
  }

  /**
   * Returns the active local MediaStream
   */
  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Returns the remote peer's ID currently connected in the call
   */
  public getCurrentCallPeer(): string | null {
    return this.currentCallPeer;
  }

  /**
   * Initializes local media streams (microphone & camera)
   */
  public async initializeLocalStream(config: CallConfig): Promise<MediaStream> {
    this.callbacks.onCallStateChange?.('acquiring');
    this.callbacks.onLog?.('sys', 'webrtc', `Acquiring local media stream (Audio: ${config.audio}, Video: ${config.video})...`);
    
    try {
      const constraints: MediaStreamConstraints = {
        audio: config.audio,
        video: config.video ? { facingMode: 'user' } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;
      this.callbacks.onLocalStream?.(stream);
      this.callbacks.onCallStateChange?.('idle');
      this.callbacks.onLog?.('sys', 'webrtc', 'Local media stream successfully captured.');
      return stream;
    } catch (e: any) {
      this.callbacks.onLog?.('sys', 'webrtc', `Media Stream capture failed: ${e.message}`);
      this.callbacks.onCallStateChange?.('idle');
      throw e;
    }
  }

  /**
   * Initiates an RTCPeerConnection and triggers a real SDP offer
   */
  public async createCall(targetUserId: string, constraints?: MediaStreamConstraints): Promise<void> {
    this.isCaller = true;
    this.currentCallPeer = targetUserId;
    this.callbacks.onCallStateChange?.('acquiring');

    try {
      this.callbacks.onLog?.('sys', 'webrtc', 'Acquiring microphone and camera stream for call...');
      const streamConstraints = constraints || { audio: true, video: true };
      const stream = await navigator.mediaDevices.getUserMedia(streamConstraints);
      this.localStream = stream;
      this.callbacks.onLocalStream?.(stream);
      this.callbacks.onCallStateChange?.('calling');

      const pc = this.createPeerConnection(targetUserId);

      // Attach tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      this.callbacks.onLog?.('sys', 'webrtc', `Constructing real SDP Offer for "${targetUserId}"...`);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const offerPayload = {
        type: 'offer',
        roomId: this.roomId,
        targetId: targetUserId,
        sdp: pc.localDescription
      };

      this.callbacks.onSignalingMessage?.(offerPayload);
      this.callbacks.onLog?.('out', 'offer', offerPayload);
    } catch (err: any) {
      this.callbacks.onLog?.('sys', 'webrtc', `Failed to create call: ${err.message}`);
      this.endCall();
      throw err;
    }
  }

  /**
   * Creates an RTCPeerConnection for a remote peer (retains original name signature)
   */
  public createPeerConnection(peerId: string, onIceCandidate?: (candidate: RTCIceCandidate) => void): RTCPeerConnection {
    this.callbacks.onLog?.('sys', 'webrtc', `Initializing native RTCPeerConnection for peer "${peerId}"...`);
    
    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
      iceTransportPolicy: 'all'
    });

    this.peerConnection = pc;
    this.currentCallPeer = peerId;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (onIceCandidate) {
          onIceCandidate(event.candidate);
        }
        
        const candidatePayload = {
          type: 'ice-candidate',
          roomId: this.roomId,
          targetId: peerId,
          candidate: event.candidate
        };
        this.callbacks.onSignalingMessage?.(candidatePayload);
        this.callbacks.onLog?.('out', 'ice-candidate', { targetId: peerId });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.callbacks.onConnStateChange?.(state);
      this.callbacks.onLog?.('sys', 'webrtc', `RTCPeerConnection connectionState is: "${state}"`);
      
      if (state === 'connected') {
        this.startStatsMonitoring();
        this.callbacks.onCallStateChange?.('connected');
      } else if (state === 'failed') {
        this.callbacks.onLog?.('sys', 'webrtc', 'WebRTC connection failed. Closing.');
        this.endCall();
      } else if (state === 'closed' || state === 'disconnected') {
        this.stopStatsMonitoring();
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      this.callbacks.onIceStateChange?.(state);
      this.callbacks.onLog?.('sys', 'webrtc', `WebRTC ICE ConnectionState changed to: "${state}"`);
    };

    pc.onsignalingstatechange = () => {
      const state = pc.signalingState;
      this.callbacks.onSigStateChange?.(state);
      this.callbacks.onLog?.('sys', 'webrtc', `WebRTC signalingState changed to: "${state}"`);
    };

    pc.ontrack = (event) => {
      this.callbacks.onLog?.('sys', 'webrtc', `Remote media track received: kind="${event.track.kind}"`);
      if (event.streams && event.streams[0]) {
        this.callbacks.onRemoteStream?.(event.streams[0]);
      }
    };

    return pc;
  }

  /**
   * Handles an incoming Call SDP Offer message
   */
  public handleIncomingOffer(senderId: string, offer: RTCSessionDescriptionInit): void {
    this.currentCallPeer = senderId;
    this.pendingOffer = offer;
    this.callbacks.onCallStateChange?.('ringing');
    this.callbacks.onLog?.('sys', 'webrtc', `Incoming call request detected from peer "${senderId}".`);
  }

  /**
   * Accepts an incoming call offer, activates local devices, and returns an Answer SDP
   */
  public async acceptCall(constraints?: MediaStreamConstraints): Promise<void> {
    if (!this.currentCallPeer || !this.pendingOffer) {
      throw new Error("No pending incoming call to accept.");
    }
    const peerId = this.currentCallPeer;
    const offer = this.pendingOffer;
    this.pendingOffer = null;

    this.callbacks.onCallStateChange?.('acquiring');

    try {
      this.callbacks.onLog?.('sys', 'webrtc', 'Acquiring local media stream to accept incoming call...');
      const streamConstraints = constraints || { audio: true, video: true };
      const stream = await navigator.mediaDevices.getUserMedia(streamConstraints);
      this.localStream = stream;
      this.callbacks.onLocalStream?.(stream);
      this.callbacks.onCallStateChange?.('calling');

      const pc = this.createPeerConnection(peerId);

      // Add local tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      this.callbacks.onLog?.('sys', 'webrtc', "Applying caller's remote SDP configuration offer...");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush early candidates
      await this.flushPendingIceCandidates();

      this.callbacks.onLog?.('sys', 'webrtc', "Constructing real SDP Answer...");
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const answerPayload = {
        type: 'answer',
        roomId: this.roomId,
        targetId: peerId,
        sdp: pc.localDescription
      };

      this.callbacks.onSignalingMessage?.(answerPayload);
      this.callbacks.onLog?.('out', 'answer', answerPayload);
    } catch (err: any) {
      this.callbacks.onLog?.('sys', 'webrtc', `Failed to answer incoming call: ${err.message}`);
      this.endCall();
      throw err;
    }
  }

  /**
   * Handles a call decline signal
   */
  public declineCall(): void {
    if (this.currentCallPeer) {
      this.callbacks.onLog?.('sys', 'webrtc', `Declining incoming call request from "${this.currentCallPeer}".`);
      const declinePayload = {
        type: 'call-decline',
        roomId: this.roomId,
        targetId: this.currentCallPeer,
        reason: 'declined'
      };
      this.callbacks.onSignalingMessage?.(declinePayload);
      this.callbacks.onLog?.('out', 'call-decline', declinePayload);
    }
    this.resetCallState();
  }

  /**
   * Handles an incoming SDP Answer message from the peer
   */
  public async handleIncomingAnswer(senderId: string, answerSdp: RTCSessionDescriptionInit): Promise<void> {
    if (this.peerConnection && this.currentCallPeer === senderId) {
      this.callbacks.onLog?.('sys', 'webrtc', `SDP Answer from "${senderId}" received. Setting remote description.`);
      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
        this.callbacks.onLog?.('sys', 'webrtc', 'Remote SDP session configuration applied successfully.');
        await this.flushPendingIceCandidates();
      } catch (err: any) {
        this.callbacks.onLog?.('sys', 'webrtc', `Failed to apply SDP answer: ${err.message}`);
      }
    }
  }

  /**
   * Handles an incoming ICE candidate from the remote peer
   */
  public async handleIceCandidate(senderId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (this.peerConnection && this.currentCallPeer === senderId) {
      if (this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          this.callbacks.onLog?.('sys', 'webrtc', `Remote ICE candidate applied from "${senderId}".`);
        } catch (e: any) {
          // Suppress minor ICE Candidate warnings
        }
      } else {
        this.callbacks.onLog?.('sys', 'webrtc', `Queuing ICE candidate from "${senderId}" (Remote description not set yet).`);
        this.pendingIceCandidates.push(candidate);
      }
    }
  }

  /**
   * Mutes or unmutes the local microphone track
   */
  public muteMic(muted?: boolean): void {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        if (muted !== undefined) {
          audioTrack.enabled = !muted;
          this.isMuted = muted;
        } else {
          audioTrack.enabled = !audioTrack.enabled;
          this.isMuted = !audioTrack.enabled;
        }
        this.callbacks.onLog?.('sys', 'webrtc', `Microphone ${this.isMuted ? 'muted' : 'unmuted'} locally.`);
      }
    }
  }

  /**
   * Enables or disables the local camera track
   */
  public toggleCamera(enabled?: boolean): void {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        if (enabled !== undefined) {
          videoTrack.enabled = enabled;
          this.isCameraOff = !enabled;
        } else {
          videoTrack.enabled = !videoTrack.enabled;
          this.isCameraOff = !videoTrack.enabled;
        }
        this.callbacks.onLog?.('sys', 'webrtc', `Camera ${this.isCameraOff ? 'disabled' : 'enabled'} locally.`);
      }
    }
  }

  /**
   * Sends a hangup signal to the remote peer and cleans up local connections
   */
  public endCall(): void {
    if (this.currentCallPeer) {
      this.callbacks.onLog?.('sys', 'webrtc', `Sending hangup signal to peer "${this.currentCallPeer}"...`);
      const hangupPayload = {
        type: 'hangup',
        roomId: this.roomId,
        targetId: this.currentCallPeer
      };
      try {
        this.callbacks.onSignalingMessage?.(hangupPayload);
        this.callbacks.onLog?.('out', 'hangup', hangupPayload);
      } catch (e) {}
    }
    this.resetCallState();
  }

  /**
   * Disposes of RTCPeerConnections and releases device tracks (retains original name signature)
   */
  public terminateAllCalls(): void {
    this.resetCallState();
  }

  /**
   * Local connection state cleaner
   */
  public resetCallState(): void {
    this.callbacks.onLog?.('sys', 'webrtc', 'Tearing down RTCPeerConnection and closing media tracks.');
    
    this.stopStatsMonitoring();

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {}
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.currentCallPeer = null;
    this.pendingOffer = null;
    this.pendingIceCandidates = [];
    this.isCaller = false;
    this.isMuted = false;
    this.isCameraOff = false;

    // Clear streams via callbacks
    this.callbacks.onLocalStream?.(new MediaStream());
    this.callbacks.onRemoteStream?.(new MediaStream());
    this.callbacks.onCallStateChange?.('idle');
  }

  /**
   * Flushes all queued remote ICE candidates after a remote description has been set
   */
  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.peerConnection) return;
    if (this.pendingIceCandidates.length === 0) return;

    this.callbacks.onLog?.('sys', 'webrtc', `Applying ${this.pendingIceCandidates.length} queued remote ICE candidates...`);
    for (const candidate of this.pendingIceCandidates) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {}
    }
    this.pendingIceCandidates = [];
  }

  /**
   * Activates automated real-time quality and packet loss stats monitoring
   */
  private startStatsMonitoring(): void {
    if (this.statsInterval) clearInterval(this.statsInterval);
    let lastPacketsReceived = 0;
    let lastPacketsLost = 0;
    let isFallbackAudioOnly = false;

    this.statsInterval = setInterval(async () => {
      if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') return;

      try {
        const stats = await this.peerConnection.getStats();
        let inboundVideoStats: any = null;
        let activeCandidatePair: any = null;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
            inboundVideoStats = report;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            activeCandidatePair = report;
          }
        });

        if (inboundVideoStats) {
          const currentLost = inboundVideoStats.packetsLost || 0;
          const currentReceived = inboundVideoStats.packetsReceived || 0;

          const deltaLost = currentLost - lastPacketsLost;
          const deltaReceived = currentReceived - lastPacketsReceived;
          const totalDelta = deltaLost + deltaReceived;

          if (totalDelta > 20) {
            const lossRatio = deltaLost / totalDelta;
            this.callbacks.onLog?.('sys', 'webrtc', `[Stats Monitor] Video Packet Loss Ratio: ${(lossRatio * 100).toFixed(1)}%`);
            
            if (lossRatio > 0.20 && !isFallbackAudioOnly) {
              isFallbackAudioOnly = true;
              this.callbacks.onLog?.('sys', 'webrtc', '[QUALITY FALLBACK] Heavy packet loss (>20%) detected. Demoting to Audio-Only.');
              this.toggleCamera(false);
            }
          }

          lastPacketsLost = currentLost;
          lastPacketsReceived = currentReceived;
        }

        if (activeCandidatePair && activeCandidatePair.currentRoundTripTime) {
          const rtt = activeCandidatePair.currentRoundTripTime * 1000;
          this.callbacks.onLog?.('sys', 'webrtc', `[Stats Monitor] Network Round-Trip Time (RTT): ${rtt.toFixed(0)}ms`);
          if (rtt > 800 && !isFallbackAudioOnly) {
            isFallbackAudioOnly = true;
            this.callbacks.onLog?.('sys', 'webrtc', '[QUALITY FALLBACK] High latency (>800ms) detected. Demoting to Audio-Only.');
            this.toggleCamera(false);
          }
        }
      } catch (e) {
        // Stats are not ready
      }
    }, 3000);
  }

  /**
   * Cleans up the quality stats monitor timer
   */
  private stopStatsMonitoring(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }
}
