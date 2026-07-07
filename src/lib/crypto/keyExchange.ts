import sodium from 'libsodium-wrappers';
import { hkdf, ensureReady } from './hkdf';

export interface KeyPair {
  publicKey: string;  // Base64
  privateKey: string; // Base64
}

export interface BobPrekeyBundle {
  identityPublicKey: string; // Base64
  signedPrekey: string;      // Base64
  oneTimePrekey?: string;    // Base64
}

/**
 * Alice initiates X3DH and computes the shared secret.
 */
export async function aliceX3DH(
  aliceIdentity: KeyPair,
  aliceEphemeral: KeyPair,
  bobBundle: BobPrekeyBundle
): Promise<Uint8Array> {
  await ensureReady();

  const aliceIdPriv = sodium.from_base64(aliceIdentity.privateKey);
  const aliceEphPriv = sodium.from_base64(aliceEphemeral.privateKey);

  const bobIdPub = sodium.from_base64(bobBundle.identityPublicKey);
  const bobSignedPub = sodium.from_base64(bobBundle.signedPrekey);

  // DH1 = scalarmult(IK_A_priv, SPK_B_pub)
  const dh1 = sodium.crypto_scalarmult(aliceIdPriv, bobSignedPub);
  // DH2 = scalarmult(EK_A_priv, IK_B_pub)
  const dh2 = sodium.crypto_scalarmult(aliceEphPriv, bobIdPub);
  // DH3 = scalarmult(EK_A_priv, SPK_B_pub)
  const dh3 = sodium.crypto_scalarmult(aliceEphPriv, bobSignedPub);

  let totalLength = dh1.length + dh2.length + dh3.length;
  let dh4: Uint8Array | null = null;

  if (bobBundle.oneTimePrekey) {
    const bobOneTimePub = sodium.from_base64(bobBundle.oneTimePrekey);
    // DH4 = scalarmult(EK_A_priv, OPK_B_pub)
    dh4 = sodium.crypto_scalarmult(aliceEphPriv, bobOneTimePub);
    totalLength += dh4.length;
  }

  // Concatenate DH outputs
  const concatenated = new Uint8Array(totalLength);
  concatenated.set(dh1, 0);
  concatenated.set(dh2, dh1.length);
  concatenated.set(dh3, dh1.length + dh2.length);
  if (dh4) {
    concatenated.set(dh4, dh1.length + dh2.length + dh3.length);
  }

  // Derive shared secret key via HKDF (using salt of 32 zero bytes and info = "X3DH")
  const salt = new Uint8Array(32);
  const info = new Uint8Array(Array.from("X3DH").map(c => c.charCodeAt(0)));
  const sharedSecret = await hkdf(concatenated, 32, salt, info);

  // Cleanup secrets
  concatenated.fill(0);
  dh1.fill(0);
  dh2.fill(0);
  dh3.fill(0);
  if (dh4) dh4.fill(0);

  return sharedSecret;
}

/**
 * Bob receives X3DH initiation parameters and computes the same shared secret.
 */
export async function bobX3DH(
  bobIdentity: KeyPair,
  bobSignedPrekey: KeyPair,
  bobOneTimePrekey: KeyPair | null,
  aliceIdentityPubBase64: string,
  aliceEphemeralPubBase64: string
): Promise<Uint8Array> {
  await ensureReady();

  const bobSignedPriv = sodium.from_base64(bobSignedPrekey.privateKey);
  const bobIdPriv = sodium.from_base64(bobIdentity.privateKey);

  const aliceIdPub = sodium.from_base64(aliceIdentityPubBase64);
  const aliceEphPub = sodium.from_base64(aliceEphemeralPubBase64);

  // DH1 = scalarmult(SPK_B_priv, IK_A_pub)
  const dh1 = sodium.crypto_scalarmult(bobSignedPriv, aliceIdPub);
  // DH2 = scalarmult(IK_B_priv, EK_A_pub)
  const dh2 = sodium.crypto_scalarmult(bobIdPriv, aliceEphPub);
  // DH3 = scalarmult(SPK_B_priv, EK_A_pub)
  const dh3 = sodium.crypto_scalarmult(bobSignedPriv, aliceEphPub);

  let totalLength = dh1.length + dh2.length + dh3.length;
  let dh4: Uint8Array | null = null;

  if (bobOneTimePrekey) {
    const bobOneTimePriv = sodium.from_base64(bobOneTimePrekey.privateKey);
    // DH4 = scalarmult(OPK_B_priv, EK_A_pub)
    dh4 = sodium.crypto_scalarmult(bobOneTimePriv, aliceEphPub);
    totalLength += dh4.length;
  }

  // Concatenate DH outputs in the same order
  const concatenated = new Uint8Array(totalLength);
  concatenated.set(dh1, 0);
  concatenated.set(dh2, dh1.length);
  concatenated.set(dh3, dh1.length + dh2.length);
  if (dh4) {
    concatenated.set(dh4, dh1.length + dh2.length + dh3.length);
  }

  // Derive shared secret key via HKDF (must match Alice's parameters exactly)
  const salt = new Uint8Array(32);
  const info = new Uint8Array(Array.from("X3DH").map(c => c.charCodeAt(0)));
  const sharedSecret = await hkdf(concatenated, 32, salt, info);

  // Cleanup secrets
  concatenated.fill(0);
  dh1.fill(0);
  dh2.fill(0);
  dh3.fill(0);
  if (dh4) dh4.fill(0);

  return sharedSecret;
}
