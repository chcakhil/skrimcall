/**
 * Signaling Client interface and placeholder class wrapper.
 * This will handle the WebSocket signaling connection under the hood.
 */

export interface SignalingConfig {
  url: string;
  roomId: string;
  userId: string;
}

export interface SignalingMessage {
  type: string;
  roomId?: string;
  userId?: string;
  targetId?: string;
  sdp?: any;
  candidate?: any;
  members?: string[];
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private config: SignalingConfig | null = null;

  constructor() {
    // Coming in Phase 2
  }

  /**
   * Connects to the signaling server using the provided configuration.
   * [Coming in Phase 2]
   */
  public connect(config: SignalingConfig, onMessage: (msg: SignalingMessage) => void): void {
    this.config = config;
    console.log("SignalingClient: connect requested (stub)", config);
    // Connection and message routing implementation will be filled in Phase 2
  }

  /**
   * Disconnects from the signaling server.
   * [Coming in Phase 2]
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log("SignalingClient: disconnected (stub)");
  }

  /**
   * Sends a signaling payload to the WebSocket server.
   * [Coming in Phase 2]
   */
  public send(payload: SignalingMessage): void {
    console.log("SignalingClient: send requested (stub)", payload);
    // Send implementation will be filled in Phase 2
  }
}
