import sodium from 'libsodium-wrappers';
import { ensureReady } from './box';
import { hkdf, wipe } from './hkdf';

export interface SenderKeyState {
  senderKeyId: string;
  chainKey: Uint8Array;
  messageNumber: number;
  skippedMessageKeys: Map<number, Uint8Array>; // messageNumber -> messageKey
}

export interface GroupSession {
  groupId: string;
  myUserId: string;
  mySenderKeyState: SenderKeyState;
  theirSenderKeyStates: Map<string, SenderKeyState>; // peerUserId -> SenderKeyState
}

export interface GroupDistributionPayload {
  senderKeyId: string;
  senderKey: string; // Base64
  messageNumber: number;
}

export interface EncryptedGroupMessage {
  ciphertext: string; // Base64
  senderKeyId: string;
  messageNumber: number;
}

/**
 * Creates a new SenderKeyState.
 */
async function generateNewSenderKeyState(): Promise<SenderKeyState> {
  await ensureReady();
  const rawKey = sodium.randombytes_buf(32);
  const senderKeyId = sodium.to_base64(sodium.randombytes_buf(16)); // Random unique ID
  return {
    senderKeyId,
    chainKey: rawKey,
    messageNumber: 0,
    skippedMessageKeys: new Map(),
  };
}

/**
 * Initializes a Group Session for a user.
 */
export async function createGroupSession(groupId: string, myUserId: string): Promise<GroupSession> {
  await ensureReady();
  const myState = await generateNewSenderKeyState();
  return {
    groupId,
    myUserId,
    mySenderKeyState: myState,
    theirSenderKeyStates: new Map(),
  };
}

/**
 * Generates the Sender Key distribution payload to share with group members.
 */
export function generateSenderKeyDistributionPayload(session: GroupSession): GroupDistributionPayload {
  return {
    senderKeyId: session.mySenderKeyState.senderKeyId,
    senderKey: sodium.to_base64(session.mySenderKeyState.chainKey),
    messageNumber: session.mySenderKeyState.messageNumber,
  };
}

/**
 * Adds a group member's distributed Sender Key to our session store.
 */
export async function addSenderKeyFromPeer(
  session: GroupSession,
  peerUserId: string,
  payload: GroupDistributionPayload
): Promise<void> {
  await ensureReady();
  const rawKey = sodium.from_base64(payload.senderKey);
  session.theirSenderKeyStates.set(peerUserId, {
    senderKeyId: payload.senderKeyId,
    chainKey: rawKey,
    messageNumber: payload.messageNumber,
    skippedMessageKeys: new Map(),
  });
}

/**
 * Rotates own Sender Key in response to a member leaving the group.
 * Generates a new key and returns the distribution payload.
 */
export async function rotateGroupKeyOnMemberLeave(session: GroupSession): Promise<GroupDistributionPayload> {
  // Wipe old chain key
  wipe(session.mySenderKeyState.chainKey);
  
  // Generate fresh keys
  const newMyState = await generateNewSenderKeyState();
  session.mySenderKeyState = newMyState;

  return generateSenderKeyDistributionPayload(session);
}

/**
 * Encrypts a group message using our own Sender Key.
 */
export async function encryptGroupMessage(
  session: GroupSession,
  plaintext: string
): Promise<EncryptedGroupMessage> {
  await ensureReady();
  const state = session.mySenderKeyState;

  // Derive message key and step chain key
  const derived = await hkdf(state.chainKey, 64, null, Uint8Array.from("GroupCK"));
  const newChainKey = derived.slice(0, 32);
  const messageKey = derived.slice(32, 64);

  // Update sending state
  const oldChainKey = state.chainKey;
  state.chainKey = newChainKey;
  wipe(oldChainKey);

  // Encrypt plaintext with secretbox
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertextBytes = sodium.crypto_secretbox_easy(plaintext, nonce, messageKey);

  // Package nonce + ciphertext
  const combined = new Uint8Array(nonce.length + ciphertextBytes.length);
  combined.set(nonce, 0);
  combined.set(ciphertextBytes, nonce.length);
  const ciphertextBase64 = sodium.to_base64(combined);

  const messageNumber = state.messageNumber;
  state.messageNumber++;

  // Cleanup
  wipe(messageKey);
  wipe(derived);

  return {
    ciphertext: ciphertextBase64,
    senderKeyId: state.senderKeyId,
    messageNumber,
  };
}

/**
 * Decrypts a group message from a peer.
 */
export async function decryptGroupMessage(
  session: GroupSession,
  senderUserId: string,
  payload: EncryptedGroupMessage
): Promise<string> {
  await ensureReady();
  
  const state = session.theirSenderKeyStates.get(senderUserId);
  if (!state) {
    throw new Error(`decryptGroupMessage: No Sender Key registered for user ${senderUserId}`);
  }

  if (state.senderKeyId !== payload.senderKeyId) {
    throw new Error(`decryptGroupMessage: Sender Key ID mismatch (expected ${state.senderKeyId}, got ${payload.senderKeyId})`);
  }

  let messageKey: Uint8Array | undefined;

  // 1. Try out-of-order storage
  if (payload.messageNumber < state.messageNumber) {
    messageKey = state.skippedMessageKeys.get(payload.messageNumber);
    if (!messageKey) {
      throw new Error(`decryptGroupMessage: Duplicate message or expired key for index ${payload.messageNumber}`);
    }
    state.skippedMessageKeys.delete(payload.messageNumber);
  } else {
    // 2. Advance chain and skip keys if there's a gap
    if (state.messageNumber + 1000 < payload.messageNumber) {
      throw new Error("decryptGroupMessage: Message gap too large");
    }

    while (state.messageNumber < payload.messageNumber) {
      const derived = await hkdf(state.chainKey, 64, null, Uint8Array.from("GroupCK"));
      const newChainKey = derived.slice(0, 32);
      const skippedKey = derived.slice(32, 64);

      const oldChainKey = state.chainKey;
      state.chainKey = newChainKey;
      wipe(oldChainKey);
      wipe(derived);

      state.skippedMessageKeys.set(state.messageNumber, skippedKey);

      // Memory bound: Cap skipped keys map at 1000 entries
      if (state.skippedMessageKeys.size > 1000) {
        const oldestIndex = state.skippedMessageKeys.keys().next().value;
        if (oldestIndex !== undefined) {
          const keyToWipe = state.skippedMessageKeys.get(oldestIndex);
          if (keyToWipe) wipe(keyToWipe);
          state.skippedMessageKeys.delete(oldestIndex);
        }
      }

      state.messageNumber++;
    }

    // 3. Step current chain key to derive message key
    const derived = await hkdf(state.chainKey, 64, null, Uint8Array.from("GroupCK"));
    const newChainKey = derived.slice(0, 32);
    messageKey = derived.slice(32, 64);

    const oldChainKey = state.chainKey;
    state.chainKey = newChainKey;
    wipe(oldChainKey);
    wipe(derived);

    state.messageNumber++;
  }

  // 4. Decrypt payload
  try {
    const combined = sodium.from_base64(payload.ciphertext);
    if (combined.length < sodium.crypto_secretbox_NONCEBYTES) {
      throw new Error("Ciphertext too short");
    }

    const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const ciphertextBytes = combined.slice(sodium.crypto_secretbox_NONCEBYTES);

    const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertextBytes, nonce, messageKey);
    const plaintext = sodium.to_string(decryptedBytes);

    wipe(messageKey);
    return plaintext;
  } catch (err) {
    wipe(messageKey);
    throw new Error("Decryption failed: corrupted ciphertext or invalid group key");
  }
}
