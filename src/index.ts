/**
 * ============================================================================
 *                SECURE COMMUNICATION LIBRARY - PUBLIC API
 * ============================================================================
 * This is the single public entry point that exports everything a consumer app
 * needs to build secure peer-to-peer applications.
 */

// ----------------------------------------------------------------------------
// 1. CRYPTO MODULE [STATUS: ACTIVE]
// ----------------------------------------------------------------------------
export {
  generateKeyPair,
  ensureReady,
} from './lib/crypto/box';

export type { KeyPair } from './lib/crypto/box';

export {
  initSecureSession,
  encryptMessage,
  decryptMessage,
} from './lib/crypto/session';

export {
  createGroupSession,
  generateSenderKeyDistributionPayload,
  addSenderKeyFromPeer,
  rotateGroupKeyOnMemberLeave,
  encryptGroupMessage,
  decryptGroupMessage,
} from './lib/crypto/senderKeys';

export type {
  GroupSession,
  SenderKeyState,
  GroupDistributionPayload,
  EncryptedGroupMessage,
} from './lib/crypto/senderKeys';

export type {
  SessionConfig,
  InitiatorConfig,
  ResponderConfig,
} from './lib/crypto/session';

export type {
  RatchetState,
  EncryptedMessage,
} from './lib/crypto/doubleRatchet';

export {
  aliceX3DH,
  bobX3DH,
} from './lib/crypto/keyExchange';

export type {
  BobPrekeyBundle,
} from './lib/crypto/keyExchange';

// ----------------------------------------------------------------------------
// ATTACHMENT CRYPTO MODULE [STATUS: ACTIVE]
// ----------------------------------------------------------------------------
export {
  encryptAttachment,
  decryptAttachment,
  decryptAttachmentChunks,
  decryptAttachmentToStream,
} from './lib/crypto/attachments';

export type {
  EncryptedAttachment,
} from './lib/crypto/attachments';

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
