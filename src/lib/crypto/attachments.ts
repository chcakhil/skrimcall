import sodium from 'libsodium-wrappers';
import { ensureReady } from './box';

export interface EncryptedAttachment {
  encryptedBlob: Blob;
  attachmentKey: Uint8Array;
  nonce: Uint8Array; // The header of the stream acts as the 24-byte nonce
}

// 1MB chunk size chosen for performance and standard streaming chunks
export const ATTACHMENT_CHUNK_SIZE = 1024 * 1024; // 1MB

/**
 * Encrypts a Blob using libsodium's crypto_secretstream_xchacha20poly1305.
 * It streams/slices the Blob in 1MB chunks so large files are not fully loaded in memory.
 */
export async function encryptAttachment(
  fileBlob: Blob,
  chunkSize = ATTACHMENT_CHUNK_SIZE
): Promise<EncryptedAttachment> {
  await ensureReady();

  // 1. Generate random 32-byte key
  const attachmentKey = sodium.crypto_secretstream_xchacha20poly1305_keygen();

  // 2. Initialize the push stream
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(attachmentKey);

  const encryptedChunks: Uint8Array[] = [];
  const totalSize = fileBlob.size;
  let offset = 0;

  while (offset < totalSize) {
    const isLast = offset + chunkSize >= totalSize;
    const chunkBlob = fileBlob.slice(offset, offset + chunkSize);
    const arrayBuffer = await chunkBlob.arrayBuffer();
    const chunkUint8 = new Uint8Array(arrayBuffer);

    const tag = isLast 
      ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL 
      : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;

    // Encrypt the chunk
    const encryptedChunk = sodium.crypto_secretstream_xchacha20poly1305_push(
      state,
      chunkUint8,
      null,
      tag
    );

    encryptedChunks.push(encryptedChunk);
    offset += chunkSize;
  }

  // Combine into a single Blob
  const encryptedBlob = new Blob(encryptedChunks, { type: 'application/octet-stream' });

  return {
    encryptedBlob,
    attachmentKey,
    nonce: header // The header acts as the 24-byte nonce
  };
}

/**
 * Decrypts an encrypted Blob using libsodium's crypto_secretstream_xchacha20poly1305.
 * Yields decrypted chunks one by one for memory efficiency and streaming support.
 */
export async function* decryptAttachmentChunks(
  encryptedBlob: Blob,
  attachmentKey: Uint8Array,
  nonce: Uint8Array,
  chunkSize = ATTACHMENT_CHUNK_SIZE
): AsyncGenerator<Uint8Array, void, unknown> {
  await ensureReady();

  const header = nonce;
  if (header.length !== sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES) {
    throw new Error(`Invalid header length. Expected ${sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES} bytes.`);
  }
  if (attachmentKey.length !== sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES) {
    throw new Error(`Invalid key length. Expected ${sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES} bytes.`);
  }

  // Initialize pull stream
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, attachmentKey);

  const abytes = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
  const encryptedChunkSize = chunkSize + abytes;

  const totalSize = encryptedBlob.size;
  let offset = 0;

  while (offset < totalSize) {
    const chunkBlob = encryptedBlob.slice(offset, offset + encryptedChunkSize);
    const arrayBuffer = await chunkBlob.arrayBuffer();
    const chunkUint8 = new Uint8Array(arrayBuffer);

    // Decrypt chunk
    const decryptedResult = sodium.crypto_secretstream_xchacha20poly1305_pull(
      state,
      chunkUint8,
      null
    );

    if (!decryptedResult) {
      throw new Error("Decryption failed: Ciphertext has been tampered with or key is invalid.");
    }

    yield decryptedResult.message;
    offset += encryptedChunkSize;
  }
}

/**
 * Decrypts an encrypted Blob completely and returns the original Blob.
 */
export async function decryptAttachment(
  encryptedBlob: Blob,
  attachmentKey: Uint8Array,
  nonce: Uint8Array,
  chunkSize = ATTACHMENT_CHUNK_SIZE
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of decryptAttachmentChunks(encryptedBlob, attachmentKey, nonce, chunkSize)) {
    chunks.push(chunk);
  }
  return new Blob(chunks);
}

/**
 * Returns a ReadableStream of decrypted Uint8Array chunks, allowing e.g. video streaming.
 */
export function decryptAttachmentToStream(
  encryptedBlob: Blob,
  attachmentKey: Uint8Array,
  nonce: Uint8Array,
  chunkSize = ATTACHMENT_CHUNK_SIZE
): ReadableStream<Uint8Array> {
  const chunkIterator = decryptAttachmentChunks(encryptedBlob, attachmentKey, nonce, chunkSize);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await chunkIterator.next();
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value as Uint8Array);
        }
      } catch (err) {
        controller.error(err);
      }
    }
  });
}
