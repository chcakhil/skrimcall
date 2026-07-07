import { describe, it, expect } from 'vitest';
import { generateKeyPair, ensureReady } from './box';
import { initRatchet, ratchetEncrypt, ratchetDecrypt } from './doubleRatchet';

describe('Double Ratchet Algorithm Tests', () => {
  it('should support a basic back-and-forth conversation stays in sync', async () => {
    await ensureReady();

    // Setup: Shared secret (e.g. from X3DH)
    const sharedSecret = new Uint8Array(32);
    sharedSecret.fill(0xaa);

    const bobInitialKeyPair = await generateKeyPair();

    // Initialize Alice (initiator) and Bob (responder)
    const aliceState = await initRatchet(sharedSecret, true, bobInitialKeyPair.publicKey);
    const bobState = await initRatchet(sharedSecret, false);
    // Since Bob is receiver, we inject Bob's initial keypair as his sendingDHKeyPair to align with Alice's setup
    bobState.sendingDHKeyPair = bobInitialKeyPair;

    // Alice -> Bob: Message 1
    const msg1 = await ratchetEncrypt(aliceState, "Hello Bob! This is message 1 from Alice.");
    const decrypted1 = await ratchetDecrypt(bobState, msg1.header, msg1.ciphertext);
    expect(decrypted1).toBe("Hello Bob! This is message 1 from Alice.");

    // Bob -> Alice: Message 2
    const msg2 = await ratchetEncrypt(bobState, "Hi Alice! I received message 1.");
    const decrypted2 = await ratchetDecrypt(aliceState, msg2.header, msg2.ciphertext);
    expect(decrypted2).toBe("Hi Alice! I received message 1.");

    // Alice -> Bob: Message 3
    const msg3 = await ratchetEncrypt(aliceState, "Good to hear! Let's continue the secure chat.");
    const decrypted3 = await ratchetDecrypt(bobState, msg3.header, msg3.ciphertext);
    expect(decrypted3).toBe("Good to hear! Let's continue the secure chat.");
  });

  it('should decrypt messages correctly when delivered out-of-order', async () => {
    await ensureReady();

    const sharedSecret = new Uint8Array(32);
    sharedSecret.fill(0xcc);
    const bobInitialKeyPair = await generateKeyPair();

    const aliceState = await initRatchet(sharedSecret, true, bobInitialKeyPair.publicKey);
    const bobState = await initRatchet(sharedSecret, false);
    bobState.sendingDHKeyPair = bobInitialKeyPair;

    // Alice encrypts 3 sequential messages
    const msg1 = await ratchetEncrypt(aliceState, "Message #1");
    const msg2 = await ratchetEncrypt(aliceState, "Message #2");
    const msg3 = await ratchetEncrypt(aliceState, "Message #3");

    // Deliver msg3 first (Bob skips msg1 and msg2, stores their keys)
    const decrypted3 = await ratchetDecrypt(bobState, msg3.header, msg3.ciphertext);
    expect(decrypted3).toBe("Message #3");
    expect(bobState.skippedMessageKeys.size).toBe(2);

    // Deliver msg1 (Bob uses stored skipped key)
    const decrypted1 = await ratchetDecrypt(bobState, msg1.header, msg1.ciphertext);
    expect(decrypted1).toBe("Message #1");
    expect(bobState.skippedMessageKeys.size).toBe(1);

    // Deliver msg2 (Bob uses stored skipped key)
    const decrypted2 = await ratchetDecrypt(bobState, msg2.header, msg2.ciphertext);
    expect(decrypted2).toBe("Message #2");
    expect(bobState.skippedMessageKeys.size).toBe(0);
  });

  it('should enforce replay protection (used keys cannot decrypt a second time)', async () => {
    await ensureReady();

    const sharedSecret = new Uint8Array(32);
    sharedSecret.fill(0xdd);
    const bobInitialKeyPair = await generateKeyPair();

    const aliceState = await initRatchet(sharedSecret, true, bobInitialKeyPair.publicKey);
    const bobState = await initRatchet(sharedSecret, false);
    bobState.sendingDHKeyPair = bobInitialKeyPair;

    // Alice encrypts 2 messages
    const msg1 = await ratchetEncrypt(aliceState, "Message #1");
    const msg2 = await ratchetEncrypt(aliceState, "Message #2");

    // Deliver msg2 first (msg1's key is skipped & stored)
    const decrypted2 = await ratchetDecrypt(bobState, msg2.header, msg2.ciphertext);
    expect(decrypted2).toBe("Message #2");

    // Deliver msg1 once (success, key removed from store)
    const decrypted1 = await ratchetDecrypt(bobState, msg1.header, msg1.ciphertext);
    expect(decrypted1).toBe("Message #1");

    // Attempt to replay msg1 (fails because key was deleted)
    await expect(
      ratchetDecrypt(bobState, msg1.header, msg1.ciphertext)
    ).rejects.toThrow("Decryption failed");
  });

  it('should satisfy forward secrecy (past keys cannot be derived after ratcheting)', async () => {
    await ensureReady();

    const sharedSecret = new Uint8Array(32);
    sharedSecret.fill(0xee);
    const bobInitialKeyPair = await generateKeyPair();

    const aliceState = await initRatchet(sharedSecret, true, bobInitialKeyPair.publicKey);
    const bobState = await initRatchet(sharedSecret, false);
    bobState.sendingDHKeyPair = bobInitialKeyPair;

    // Send a message to establish session keys
    const msg1 = await ratchetEncrypt(aliceState, "First setup msg");
    await ratchetDecrypt(bobState, msg1.header, msg1.ciphertext);

    // Alice sends another 3 messages
    const msg2 = await ratchetEncrypt(aliceState, "Message 2");
    const msg3 = await ratchetEncrypt(aliceState, "Message 3");
    const msg4 = await ratchetEncrypt(aliceState, "Message 4");

    // Bob decrypts them in order, advancing the state
    await ratchetDecrypt(bobState, msg2.header, msg2.ciphertext);
    await ratchetDecrypt(bobState, msg3.header, msg3.ciphertext);
    await ratchetDecrypt(bobState, msg4.header, msg4.ciphertext);

    // Bob has ratcheted forward completely.
    // Try to decrypt Message 2 again (should fail because the chain key advanced and past keys are discarded)
    await expect(
      ratchetDecrypt(bobState, msg2.header, msg2.ciphertext)
    ).rejects.toThrow("Decryption failed");
  });
});
