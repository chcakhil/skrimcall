/**
 * ============================================================================
 *                SECURE COMMUNICATION LIBRARY - PUBLIC API
 * ============================================================================
 * This is the single public entry point that exports everything a consumer app
 * needs to build secure peer-to-peer applications.
 */

// ----------------------------------------------------------------------------
// 1. CRYPTO MODULE [STATUS: DONE / ACTIVE]
// ----------------------------------------------------------------------------
export {
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  ensureReady,
} from './lib/crypto/box';

export type { KeyPair } from './lib/crypto/box';

// ----------------------------------------------------------------------------
// 2. SIGNALING MODULE [STATUS: PLANNED - COMING IN PHASE 2]
// ----------------------------------------------------------------------------
export {
  SignalingClient,
} from './lib/signaling/client';

export type {
  SignalingConfig,
  SignalingMessage,
} from './lib/signaling/client';

// ----------------------------------------------------------------------------
// 3. CALLING (WebRTC) MODULE [STATUS: PLANNED - COMING IN PHASE 3]
// ----------------------------------------------------------------------------
export {
  CallManager,
} from './lib/calling/webrtc';

export type {
  CallConfig,
} from './lib/calling/webrtc';
