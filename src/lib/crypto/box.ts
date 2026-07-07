import sodium from 'libsodium-wrappers';

export interface KeyPair {
  publicKey: string;  // Base64 encoded
  privateKey: string; // Base64 encoded
}

/**
 * Ensures that libsodium is loaded and ready to use.
 */
export async function ensureReady(): Promise<void> {
  await sodium.ready;
}

/**
 * Generates a public/private keypair client-side for asymmetric box encryption.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  await ensureReady();
  const pair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(pair.publicKey),
    privateKey: sodium.to_base64(pair.privateKey)
  };
}

/**
 * Encrypts a message using recipient's public key and sender's private key.
 * Prepends the 24-byte nonce to the ciphertext, then returns the combined payload in Base64 format.
 * 
 * @param plaintext The secret message string to encrypt.
 * @param recipientPublicKeyBase64 The base64 encoded public key of the recipient.
 * @param senderPrivateKeyBase64 The base64 encoded private key of the sender.
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKeyBase64: string,
  senderPrivateKeyBase64: string
): Promise<string> {
  await ensureReady();

  try {
    const recipientPubKey = sodium.from_base64(recipientPublicKeyBase64);
    const senderPrivKey = sodium.from_base64(senderPrivateKeyBase64);

    // Generate a secure random 24-byte nonce
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);

    // Encrypt the message.
    // plaintext is converted internally to Uint8Array by crypto_box_easy
    const ciphertext = sodium.crypto_box_easy(
      plaintext,
      nonce,
      recipientPubKey,
      senderPrivKey
    );

    // Combine nonce and ciphertext: [nonce (24 bytes)][ciphertext]
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce, 0);
    combined.set(ciphertext, nonce.length);

    // Return as single base64 string
    return sodium.to_base64(combined);
  } catch (err: any) {
    throw new Error(`Encryption failed: ${err?.message || err}`);
  }
}

/**
 * Decrypts a combined ciphertext payload (containing nonce + ciphertext) using the
 * sender's public key and recipient's private key.
 * 
 * @param combinedBase64 The base64 encoded combined payload [nonce][ciphertext].
 * @param senderPublicKeyBase64 The base64 encoded public key of the sender.
 * @param recipientPrivateKeyBase64 The base64 encoded private key of the recipient.
 */
export async function decryptMessage(
  combinedBase64: string,
  senderPublicKeyBase64: string,
  recipientPrivateKeyBase64: string
): Promise<string> {
  await ensureReady();

  try {
    const senderPubKey = sodium.from_base64(senderPublicKeyBase64);
    const recipientPrivKey = sodium.from_base64(recipientPrivateKeyBase64);
    const combined = sodium.from_base64(combinedBase64);

    if (combined.length < sodium.crypto_box_NONCEBYTES) {
      throw new Error("Ciphertext too short (missing nonce)");
    }

    // Split nonce and ciphertext
    const nonce = combined.slice(0, sodium.crypto_box_NONCEBYTES);
    const ciphertext = combined.slice(sodium.crypto_box_NONCEBYTES);

    // Decrypt
    const decryptedBytes = sodium.crypto_box_open_easy(
      ciphertext,
      nonce,
      senderPubKey,
      recipientPrivKey
    );

    // Convert back to original string
    return sodium.to_string(decryptedBytes);
  } catch (err: any) {
    // Fail-closed behavior: throw clear error if decryption fails (due to wrong key, etc.)
    throw new Error("Decryption failed: invalid keys or corrupted ciphertext");
  }
}
