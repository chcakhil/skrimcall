import { describe, it, expect } from 'vitest';
import { generateKeyPair, encryptMessage, decryptMessage, ensureReady } from './box';

describe('End-to-End Encryption with Libsodium (Relocated Box)', () => {
  
  it('should generate valid Base64 encoded public and private keypairs', async () => {
    await ensureReady();
    const alice = await generateKeyPair();
    
    expect(alice.publicKey).toBeDefined();
    expect(alice.privateKey).toBeDefined();
    expect(typeof alice.publicKey).toBe('string');
    expect(typeof alice.privateKey).toBe('string');
    
    // Ensure they are non-empty and look like base64
    expect(alice.publicKey.length).toBeGreaterThan(10);
    expect(alice.privateKey.length).toBeGreaterThan(10);
  });

  it('should successfully encrypt and decrypt a message (happy path)', async () => {
    await ensureReady();
    
    // Generate keypairs for Alice (sender) and Bob (recipient)
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    
    const originalMessage = "Hello Bob! This is a secret message from Alice.";
    
    // Alice encrypts a message for Bob
    const ciphertext = await encryptMessage(
      originalMessage,
      bob.publicKey,      // Recipient's public key
      alice.privateKey    // Sender's private key
    );
    
    expect(ciphertext).toBeDefined();
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext).not.toEqual(originalMessage);
    
    // Bob decrypts the message
    const decryptedMessage = await decryptMessage(
      ciphertext,
      alice.publicKey,    // Sender's public key
      bob.privateKey      // Recipient's private key
    );
    
    expect(decryptedMessage).toEqual(originalMessage);
  });

  it('should never contain the human-readable plaintext in the ciphertext', async () => {
    await ensureReady();
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    
    const plaintext = "TopSecretPassword123";
    const ciphertext = await encryptMessage(plaintext, bob.publicKey, alice.privateKey);
    
    // Ensure plaintext is not human-readable within the ciphertext
    expect(ciphertext).not.toContain(plaintext);
    
    // Even decoding from base64 should not contain the exact plaintext directly in plain view
    const binaryPlaintext = Buffer.from(plaintext);
    const binaryCiphertext = Buffer.from(ciphertext, 'base64');
    
    expect(binaryCiphertext.includes(binaryPlaintext)).toBe(false);
  });

  it('should fail to decrypt when using the wrong recipient private key (wrong recipient)', async () => {
    await ensureReady();
    
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const charlie = await generateKeyPair(); // Intruder / third-party
    
    const message = "Secret plans for tomorrow's launch";
    
    // Alice encrypts for Bob
    const ciphertext = await encryptMessage(message, bob.publicKey, alice.privateKey);
    
    // Charlie tries to decrypt it using his own private key (should fail)
    await expect(
      decryptMessage(ciphertext, alice.publicKey, charlie.privateKey)
    ).rejects.toThrow("Decryption failed");
  });

  it('should fail to decrypt if the sender public key is incorrect/spoofed (authenticity fail)', async () => {
    await ensureReady();
    
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const charlie = await generateKeyPair(); // Spoofed sender
    
    const message = "Alice's official authorization statement";
    
    // Alice encrypts for Bob
    const ciphertext = await encryptMessage(message, bob.publicKey, alice.privateKey);
    
    // Bob tries to decrypt, but gets Charlie's public key instead of Alice's
    await expect(
      decryptMessage(ciphertext, charlie.publicKey, bob.privateKey)
    ).rejects.toThrow("Decryption failed");
  });
});
