import { describe, it, expect } from 'vitest';
import { generateKeyPair, ensureReady } from './box';
import { initSecureSession, encryptMessage, decryptMessage } from './session';

describe('Unified Secure Session Tests', () => {
  it('should run a complete X3DH + Double Ratchet session end-to-end', async () => {
    await ensureReady();

    // 1. Generate keys for Alice (Initiator)
    const aliceIdentity = await generateKeyPair();
    const aliceEphemeral = await generateKeyPair();

    // 2. Generate keys for Bob (Responder)
    const bobIdentity = await generateKeyPair();
    const bobSignedPrekey = await generateKeyPair();
    const bobOneTimePrekey = await generateKeyPair();

    // 3. Alice initiates session using Bob's prekey bundle
    const aliceState = await initSecureSession({
      isInitiator: true,
      myIdentityKeyPair: aliceIdentity,
      myEphemeralKeyPair: aliceEphemeral,
      theirPrekeyBundle: {
        identityPublicKey: bobIdentity.publicKey,
        signedPrekey: bobSignedPrekey.publicKey,
        oneTimePrekey: bobOneTimePrekey.publicKey,
      }
    });

    // 4. Bob receives Alice's initialization parameters and starts his session
    const bobState = await initSecureSession({
      isInitiator: false,
      myIdentityKeyPair: bobIdentity,
      mySignedPrekey: bobSignedPrekey,
      myOneTimePrekey: bobOneTimePrekey,
      theirIdentityPublicKey: aliceIdentity.publicKey,
      theirEphemeralPublicKey: aliceEphemeral.publicKey,
    });

    // 5. Test Alice sending messages to Bob
    const msg1 = await encryptMessage(aliceState, "Hello Bob! This is our secure session!");
    const decrypted1 = await decryptMessage(bobState, msg1.header, msg1.ciphertext);
    expect(decrypted1).toBe("Hello Bob! This is our secure session!");

    const msg2 = await encryptMessage(aliceState, "Hope the Double Ratchet works perfectly.");
    const decrypted2 = await decryptMessage(bobState, msg2.header, msg2.ciphertext);
    expect(decrypted2).toBe("Hope the Double Ratchet works perfectly.");

    // 6. Test Bob sending replies back to Alice
    const reply1 = await encryptMessage(bobState, "Hi Alice, it works flawlessly!");
    const decryptedReply1 = await decryptMessage(aliceState, reply1.header, reply1.ciphertext);
    expect(decryptedReply1).toBe("Hi Alice, it works flawlessly!");
  });
});
