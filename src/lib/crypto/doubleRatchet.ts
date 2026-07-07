import sodium from 'libsodium-wrappers';
import { generateKeyPair, ensureReady, KeyPair } from './box';
import { hkdf, wipe } from './hkdf';

export interface RatchetState {
  rootKey: Uint8Array;
  sendingChainKey: Uint8Array | null;
  receivingChainKey: Uint8Array | null;
  sendingDHKeyPair: KeyPair;
  receivingDHPublicKey: string | null; // Base64
  sendMessageNumber: number;
  receiveMessageNumber: number;
  previousChainLength: number;
  skippedMessageKeys: Map<string, Uint8Array>; // Keyed by "dhPublicKey,messageNumber"
}

export interface EncryptedMessage {
  header: {
    dhPublicKey: string; // Base64
    messageNumber: number;
    previousChainLength: number;
  };
  ciphertext: string; // Base64
}

/**
 * Initializes the Ratchet State for Alice (initiator) or Bob (responder).
 */
export async function initRatchet(
  sharedSecretFromX3DH: Uint8Array,
  isInitiator: boolean,
  theirInitialDHPublicKey?: string // Bob's SPK (Base64) for Alice
): Promise<RatchetState> {
  await ensureReady();

  // Make a copy of the shared secret to use as root key
  const rootKey = new Uint8Array(sharedSecretFromX3DH);

  if (isInitiator) {
    if (!theirInitialDHPublicKey) {
      throw new Error("initRatchet: initiator requires theirInitialDHPublicKey");
    }

    const sendingDHKeyPair = await generateKeyPair();
    
    // Perform initial DH Ratchet step to bootstrap sendingChainKey
    const privKeyBytes = sodium.from_base64(sendingDHKeyPair.privateKey);
    const pubKeyBytes = sodium.from_base64(theirInitialDHPublicKey);
    const dhSecret = sodium.crypto_scalarmult(privKeyBytes, pubKeyBytes);

    const derived = await hkdf(dhSecret, 64, rootKey, Uint8Array.from("KDF_RK"));
    const initiatorRootKey = derived.slice(0, 32);
    const sendingChainKey = derived.slice(32, 64);

    wipe(dhSecret);
    wipe(derived);

    return {
      rootKey: initiatorRootKey,
      sendingChainKey,
      receivingChainKey: null,
      sendingDHKeyPair,
      receivingDHPublicKey: theirInitialDHPublicKey,
      sendMessageNumber: 0,
      receiveMessageNumber: 0,
      previousChainLength: 0,
      skippedMessageKeys: new Map()
    };
  } else {
    // Bob receives: waits for Alice's first message to perform the initial DH ratchet
    const sendingDHKeyPair = await generateKeyPair();

    return {
      rootKey,
      sendingChainKey: null,
      receivingChainKey: null,
      sendingDHKeyPair,
      receivingDHPublicKey: null,
      sendMessageNumber: 0,
      receiveMessageNumber: 0,
      previousChainLength: 0,
      skippedMessageKeys: new Map()
    };
  }
}

/**
 * Encrypts a message and advances the sending chain.
 */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string
): Promise<EncryptedMessage> {
  if (!state.sendingChainKey) {
    throw new Error("RatchetState: sending chain key is not initialized");
  }

  // 1. Step the sending chain key
  const derived = await hkdf(state.sendingChainKey, 64, null, Uint8Array.from("KDF_CK"));
  const newSendingChainKey = derived.slice(0, 32);
  const messageKey = derived.slice(32, 64);

  const oldSendingChainKey = state.sendingChainKey;
  state.sendingChainKey = newSendingChainKey;
  wipe(oldSendingChainKey);

  // 2. Encrypt plaintext
  await ensureReady();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertextBytes = sodium.crypto_secretbox_easy(plaintext, nonce, messageKey);

  // Combine nonce + ciphertext
  const combined = new Uint8Array(nonce.length + ciphertextBytes.length);
  combined.set(nonce, 0);
  combined.set(ciphertextBytes, nonce.length);
  const ciphertextBase64 = sodium.to_base64(combined);

  const header = {
    dhPublicKey: state.sendingDHKeyPair.publicKey,
    messageNumber: state.sendMessageNumber,
    previousChainLength: state.previousChainLength
  };

  // Increment message number
  state.sendMessageNumber++;

  // Cleanup
  wipe(messageKey);
  wipe(derived);

  return { header, ciphertext: ciphertextBase64 };
}

/**
 * Helper to skip message keys and store them in state.skippedMessageKeys.
 */
async function skipMessageKeys(state: RatchetState, until: number): Promise<void> {
  if (state.receiveMessageNumber + 1000 < until) {
    throw new Error("RatchetState: message gap too large");
  }

  if (state.receivingChainKey) {
    while (state.receiveMessageNumber < until) {
      const derived = await hkdf(state.receivingChainKey, 64, null, Uint8Array.from("KDF_CK"));
      const newReceivingChainKey = derived.slice(0, 32);
      const skippedKey = derived.slice(32, 64);

      const oldReceivingChain = state.receivingChainKey;
      state.receivingChainKey = newReceivingChainKey;
      wipe(oldReceivingChain);
      wipe(derived);

      const identifier = `${state.receivingDHPublicKey},${state.receiveMessageNumber}`;
      state.skippedMessageKeys.set(identifier, skippedKey);

      // Enforce the memory bounds: cap at 1000 entries
      if (state.skippedMessageKeys.size > 1000) {
        const oldestKey = state.skippedMessageKeys.keys().next().value;
        if (oldestKey !== undefined) {
          const keyToWipe = state.skippedMessageKeys.get(oldestKey);
          if (keyToWipe) wipe(keyToWipe);
          state.skippedMessageKeys.delete(oldestKey);
        }
      }

      state.receiveMessageNumber++;
    }
  }
}

/**
 * Decrypts a message, handling out-of-order delivery and DH ratchet transitions.
 */
export async function ratchetDecrypt(
  state: RatchetState,
  header: {
    dhPublicKey: string;
    messageNumber: number;
    previousChainLength: number;
  },
  ciphertextBase64: string
): Promise<string> {
  await ensureReady();

  // 1. Try out-of-order key store first
  const skippedKeyIdentifier = `${header.dhPublicKey},${header.messageNumber}`;
  let messageKey = state.skippedMessageKeys.get(skippedKeyIdentifier);

  if (messageKey) {
    state.skippedMessageKeys.delete(skippedKeyIdentifier);
  } else {
    // 2. Perform DH ratchet if the sender's DH public key has changed
    if (header.dhPublicKey !== state.receivingDHPublicKey) {
      // Skip keys on the old chain
      await skipMessageKeys(state, header.previousChainLength);

      // Transition DH ratchet
      state.previousChainLength = state.sendMessageNumber;
      state.sendMessageNumber = 0;
      state.receiveMessageNumber = 0;
      state.receivingDHPublicKey = header.dhPublicKey;

      const privKeyBytes = sodium.from_base64(state.sendingDHKeyPair.privateKey);
      const pubKeyBytes = sodium.from_base64(state.receivingDHPublicKey);

      // Compute incoming DH secret
      const dhSecret1 = sodium.crypto_scalarmult(privKeyBytes, pubKeyBytes);
      const derived1 = await hkdf(dhSecret1, 64, state.rootKey, Uint8Array.from("KDF_RK"));
      
      const oldRootKey1 = state.rootKey;
      state.rootKey = derived1.slice(0, 32);
      if (state.receivingChainKey) wipe(state.receivingChainKey);
      state.receivingChainKey = derived1.slice(32, 64);

      wipe(oldRootKey1);
      wipe(dhSecret1);
      wipe(derived1);

      // Generate our new local DH keypair and derive outgoing chain
      const newKeyPair = await generateKeyPair();
      state.sendingDHKeyPair = newKeyPair;
      const newPrivKeyBytes = sodium.from_base64(state.sendingDHKeyPair.privateKey);

      const dhSecret2 = sodium.crypto_scalarmult(newPrivKeyBytes, pubKeyBytes);
      const derived2 = await hkdf(dhSecret2, 64, state.rootKey, Uint8Array.from("KDF_RK"));

      const oldRootKey2 = state.rootKey;
      state.rootKey = derived2.slice(0, 32);
      if (state.sendingChainKey) wipe(state.sendingChainKey);
      state.sendingChainKey = derived2.slice(32, 64);

      wipe(oldRootKey2);
      wipe(dhSecret2);
      wipe(derived2);
    }

    // 3. Skip keys on the current receiving chain
    await skipMessageKeys(state, header.messageNumber);

    // 4. Advance symmetric receiving ratchet
    if (!state.receivingChainKey) {
      throw new Error("RatchetState: receiving chain key is not initialized");
    }
    const derived = await hkdf(state.receivingChainKey, 64, null, Uint8Array.from("KDF_CK"));
    const newReceivingChainKey = derived.slice(0, 32);
    messageKey = derived.slice(32, 64);

    const oldReceivingChainKey = state.receivingChainKey;
    state.receivingChainKey = newReceivingChainKey;
    wipe(oldReceivingChainKey);
    wipe(derived);

    state.receiveMessageNumber++;
  }

  // 5. Decrypt payload
  try {
    const combined = sodium.from_base64(ciphertextBase64);
    if (combined.length < sodium.crypto_secretbox_NONCEBYTES) {
      throw new Error("Ciphertext too short");
    }

    const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const ciphertextBytes = combined.slice(sodium.crypto_secretbox_NONCEBYTES);

    const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertextBytes, nonce, messageKey);
    const plaintext = sodium.to_string(decryptedBytes);

    // Securely wipe message key from memory
    wipe(messageKey);

    return plaintext;
  } catch (err: any) {
    wipe(messageKey);
    throw new Error("Decryption failed: invalid keys or corrupted ciphertext");
  }
}
