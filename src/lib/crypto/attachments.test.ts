import { describe, it, expect } from 'vitest';
import { 
  encryptAttachment, 
  decryptAttachment, 
  decryptAttachmentChunks,
  decryptAttachmentToStream
} from './attachments';
import { ensureReady } from './box';

describe('Attachment Encryption and Decryption Tests', () => {
  it('should successfully round-trip a small text file attachment', async () => {
    await ensureReady();

    const originalText = "This is a super secret text attachment that is going to be encrypted and decrypted.";
    const fileBlob = new Blob([originalText], { type: 'text/plain' });

    // 1. Encrypt
    const { encryptedBlob, attachmentKey, nonce } = await encryptAttachment(fileBlob);

    // Verify key and nonce sizes
    expect(attachmentKey.length).toBe(32);
    expect(nonce.length).toBe(24);
    // Encrypted size should be original size + ABYTES (17)
    expect(encryptedBlob.size).toBe(originalText.length + 17);

    // 2. Decrypt
    const decryptedBlob = await decryptAttachment(encryptedBlob, attachmentKey, nonce);
    const decryptedText = await decryptedBlob.text();

    expect(decryptedText).toBe(originalText);
  });

  it('should successfully round-trip a large (multi-chunk) simulated file using chunked/streaming APIs', async () => {
    await ensureReady();

    // Use a 100KB chunk size and 250KB total file size to test multi-chunk logic
    // without hitting virtual JSDOM Blob limits / performance bottlenecks in tests.
    const testChunkSize = 100 * 1024; // 100KB
    const largeSize = 250 * 1024; // 250KB (exactly 2.5 chunks)
    const originalBytes = new Uint8Array(largeSize);
    for (let i = 0; i < largeSize; i++) {
      originalBytes[i] = i % 256;
    }
    const fileBlob = new Blob([originalBytes], { type: 'application/octet-stream' });

    // 1. Encrypt with customized chunkSize
    const { encryptedBlob, attachmentKey, nonce } = await encryptAttachment(fileBlob, testChunkSize);

    // Verified encrypted size: 2 full chunks + 1 half chunk, each adding 17 bytes overhead
    // Total overhead = 3 * 17 = 51 bytes
    expect(encryptedBlob.size).toBe(largeSize + (3 * 17));

    // 2. Decrypt using chunk generator with customized chunkSize
    const decryptedChunks: Uint8Array[] = [];
    let chunkCount = 0;
    for await (const chunk of decryptAttachmentChunks(encryptedBlob, attachmentKey, nonce, testChunkSize)) {
      decryptedChunks.push(chunk);
      chunkCount++;
    }

    expect(chunkCount).toBe(3); // chunk 1, chunk 2, and the final smaller chunk

    // Combine chunks to verify content
    const decryptedBlob = new Blob(decryptedChunks);
    const decryptedBuffer = await decryptedBlob.arrayBuffer();
    const decryptedBytes = new Uint8Array(decryptedBuffer);

    expect(decryptedBytes.length).toBe(largeSize);
    expect(decryptedBytes).toEqual(originalBytes);

    // 3. Decrypt using ReadableStream with customized chunkSize
    const stream = decryptAttachmentToStream(encryptedBlob, attachmentKey, nonce, testChunkSize);
    const reader = stream.getReader();
    const streamChunks: Uint8Array[] = [];
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      streamChunks.push(value);
    }

    const streamBlob = new Blob(streamChunks);
    const streamBuffer = await streamBlob.arrayBuffer();
    const streamBytes = new Uint8Array(streamBuffer);

    expect(streamBytes).toEqual(originalBytes);
  });

  it('should fail closed with a clear error when ciphertext is tampered with', async () => {
    await ensureReady();

    const originalText = "A sensitive file content that must not be tampered with.";
    const fileBlob = new Blob([originalText], { type: 'text/plain' });

    // 1. Encrypt
    const { encryptedBlob, attachmentKey, nonce } = await encryptAttachment(fileBlob);

    // 2. Tamper with the encrypted bytes (flip 1 bit)
    const encryptedBuffer = await encryptedBlob.arrayBuffer();
    const tamperedBytes = new Uint8Array(encryptedBuffer);
    
    // We modify a byte in the actual encrypted payload (the first few bytes are the header,
    // let's modify a byte somewhere in the middle of the ciphertext)
    const tamperIndex = 30; // beyond the 24-byte header
    tamperedBytes[tamperIndex] ^= 0x01; // flip one bit

    const tamperedBlob = new Blob([tamperedBytes], { type: 'application/octet-stream' });

    // 3. Attempt decryption and expect it to throw a clear error
    await expect(
      decryptAttachment(tamperedBlob, attachmentKey, nonce)
    ).rejects.toThrow("Decryption failed: Ciphertext has been tampered with or key is invalid.");
  });
});
