import { describe, it, expect } from 'vitest';
import { generateKeyPair, ensureReady } from './box';
import { aliceX3DH, bobX3DH } from './keyExchange';

describe('X3DH Key Exchange Tests', () => {
  it('should successfully compute identical shared secrets for Alice and Bob (with OPK)', async () => {
    await ensureReady();

    // 1. Generate Alice's keys
    const aliceIdentity = await generateKeyPair();
    const aliceEphemeral = await generateKeyPair();

    // 2. Generate Bob's keys
    const bobIdentity = await generateKeyPair();
    const bobSignedPrekey = await generateKeyPair();
    const bobOneTimePrekey = await generateKeyPair();

    // 3. Alice fetches Bob's prekey bundle
    const bobBundle = {
      identityPublicKey: bobIdentity.publicKey,
      signedPrekey: bobSignedPrekey.publicKey,
      oneTimePrekey: bobOneTimePrekey.publicKey,
    };

    // 4. Alice calculates the shared secret
    const aliceSecret = await aliceX3DH(aliceIdentity, aliceEphemeral, bobBundle);

    // 5. Bob receives Alice's parameters and calculates the shared secret
    const bobSecret = await bobX3DH(
      bobIdentity,
      bobSignedPrekey,
      bobOneTimePrekey,
      aliceIdentity.publicKey,
      aliceEphemeral.publicKey
    );

    expect(aliceSecret).toEqual(bobSecret);
    expect(aliceSecret.length).toBe(32);
  });

  it('should successfully compute identical shared secrets for Alice and Bob (without OPK)', async () => {
    await ensureReady();

    // 1. Generate Alice's keys
    const aliceIdentity = await generateKeyPair();
    const aliceEphemeral = await generateKeyPair();

    // 2. Generate Bob's keys
    const bobIdentity = await generateKeyPair();
    const bobSignedPrekey = await generateKeyPair();

    // 3. Alice fetches Bob's prekey bundle (no OPK)
    const bobBundle = {
      identityPublicKey: bobIdentity.publicKey,
      signedPrekey: bobSignedPrekey.publicKey,
    };

    // 4. Alice calculates the shared secret
    const aliceSecret = await aliceX3DH(aliceIdentity, aliceEphemeral, bobBundle);

    // 5. Bob receives Alice's parameters and calculates the shared secret
    const bobSecret = await bobX3DH(
      bobIdentity,
      bobSignedPrekey,
      null, // No OPK
      aliceIdentity.publicKey,
      aliceEphemeral.publicKey
    );

    expect(aliceSecret).toEqual(bobSecret);
    expect(aliceSecret.length).toBe(32);
  });
});
