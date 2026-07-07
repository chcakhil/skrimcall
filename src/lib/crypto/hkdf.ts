import sodium from 'libsodium-wrappers';

/**
 * Helper to ensure libsodium is ready before any cryptographic operations.
 */
export async function ensureReady(): Promise<void> {
  await sodium.ready;
}

/**
 * Utility to securely zero-fill/wipe a Uint8Array.
 */
export function wipe(arr: Uint8Array | null | undefined): void {
  if (arr) {
    arr.fill(0);
  }
}

/**
 * Computes HMAC-SHA256 using standard XOR padding and sodium.crypto_hash_sha3256.
 */
export function hmacSha256(message: Uint8Array, key: Uint8Array): Uint8Array {
  const blockSize = 64; // SHA-256 block size is 64 bytes
  const k = new Uint8Array(blockSize);

  if (key.length > blockSize) {
    const hashed = sodium.crypto_hash_sha3256(key);
    k.set(hashed, 0);
  } else {
    k.set(key, 0);
  }

  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = k[i] ^ 0x36;
    opad[i] = k[i] ^ 0x5c;
  }

  // Inner hash: H((K' ^ ipad) || message)
  const innerMsg = new Uint8Array(blockSize + message.length);
  innerMsg.set(ipad, 0);
  innerMsg.set(message, blockSize);
  const innerHash = sodium.crypto_hash_sha3256(innerMsg);

  // Outer hash: H((K' ^ opad) || innerHash)
  const outerMsg = new Uint8Array(blockSize + innerHash.length);
  outerMsg.set(opad, 0);
  outerMsg.set(innerHash, blockSize);
  const result = sodium.crypto_hash_sha3256(outerMsg);

  // Securely wipe intermediate memory buffers
  k.fill(0);
  ipad.fill(0);
  opad.fill(0);
  innerMsg.fill(0);
  outerMsg.fill(0);
  innerHash.fill(0);

  return result;
}

/**
 * HKDF-Extract(salt, IKM) -> PRK
 * Computes a pseudorandom key (PRK) from salt and input keying material (IKM).
 * 
 * HMAC-SHA256(key = salt, message = IKM)
 */
export async function hkdfExtract(salt: Uint8Array | null, IKM: Uint8Array): Promise<Uint8Array> {
  await ensureReady();
  
  let saltKey = salt;
  if (!saltKey || saltKey.length === 0) {
    saltKey = new Uint8Array(32); // 32 zeros for HMAC-SHA256
  }

  return hmacSha256(IKM, saltKey);
}

/**
 * HKDF-Expand(PRK, info, L) -> OKM
 * Expands pseudorandom key (PRK) of length 32 to output keying material (OKM) of length L.
 * 
 * T(0) = empty string
 * T(i) = HMAC-SHA256(PRK, T(i-1) | info | i)
 */
export async function hkdfExpand(PRK: Uint8Array, info: Uint8Array, L: number): Promise<Uint8Array> {
  await ensureReady();
  
  const hashLen = 32; // SHA256 output is 32 bytes
  const N = Math.ceil(L / hashLen);
  if (N > 255) {
    throw new Error("HKDF-Expand: output length exceeds limit");
  }

  const okm = new Uint8Array(L);
  let bytesWritten = 0;
  let t = new Uint8Array(0);

  for (let i = 1; i <= N; i++) {
    // Message = T(i-1) + info + byte(i)
    const msg = new Uint8Array(t.length + info.length + 1);
    msg.set(t, 0);
    msg.set(info, t.length);
    msg.set([i], t.length + info.length);

    // Compute next block
    const nextT = hmacSha256(msg, PRK);

    // Copy to output buffer
    const bytesToCopy = Math.min(hashLen, L - bytesWritten);
    okm.set(nextT.slice(0, bytesToCopy), bytesWritten);
    bytesWritten += bytesToCopy;

    // Save T(i) for next iteration
    t = nextT;
  }

  return okm;
}

/**
 * Complete HKDF derivation function.
 */
export async function hkdf(IKM: Uint8Array, L: number, salt: Uint8Array | null, info: Uint8Array): Promise<Uint8Array> {
  const prk = await hkdfExtract(salt, IKM);
  const okm = await hkdfExpand(prk, info, L);
  wipe(prk); // Clean up intermediate PRK key from memory
  return okm;
}
