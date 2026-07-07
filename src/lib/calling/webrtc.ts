/**
 * WebRTC Calling module interfaces and placeholder manager class.
 * This will coordinate RTCPeerConnection initialization, local/remote streams,
 * and SDP/ICE signaling handshakes.
 */

export interface CallConfig {
  iceServers?: RTCIceServer[];
  audio: boolean;
  video: boolean;
}

export class CallManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;

  constructor() {
    // Coming in Phase 3
  }

  /**
   * Initializes local media streams (audio, video camera)
   * [Coming in Phase 3]
   */
  public async initializeLocalStream(config: CallConfig): Promise<MediaStream> {
    console.log("CallManager: initializeLocalStream requested (stub)", config);
    // getUserMedia logic will be filled in Phase 3
    return new MediaStream();
  }

  /**
   * Creates an RTCPeerConnection for a remote peer.
   * [Coming in Phase 3]
   */
  public createPeerConnection(peerId: string, onIceCandidate: (candidate: RTCIceCandidate) => void): RTCPeerConnection {
    console.log("CallManager: createPeerConnection requested (stub) for peer", peerId);
    // RTCPeerConnection constructor and track bindings will be filled in Phase 3
    throw new Error("createPeerConnection stub - implementation coming in Phase 3");
  }

  /**
   * Closes all active calls and releases media devices.
   * [Coming in Phase 3]
   */
  public terminateAllCalls(): void {
    console.log("CallManager: terminateAllCalls requested (stub)");
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }
}
