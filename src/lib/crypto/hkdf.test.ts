import { describe, it, expect } from 'vitest';
import { hkdf, ensureReady, hmacSha256 } from './hkdf';

describe('HKDF Key Derivation Tests', () => {
  it('should correctly calculate HMAC-SHA256 values', async () => {
    await ensureReady();
    const key = new Uint8Array(16);
    key.fill(0x0a);
    const message = new Uint8Array([1, 2, 3, 4, 5]);

    const hmacVal = hmacSha256(message, key);
    expect(hmacVal).toBeDefined();
    expect(hmacVal.length).toBe(32);
    
    // Ensure determinism
    expect(hmacSha256(message, key)).toEqual(hmacVal);
  });

  it('should correctly derive keys of different lengths', async () => {
    await ensureReady();
    const ikm = new Uint8Array(32);
    ikm.fill(0x01);
    
    const info = new Uint8Array([1, 2, 3]);
    const salt = new Uint8Array(32);
    salt.fill(0x02);

    const key1 = await hkdf(ikm, 16, salt, info);
    const key2 = await hkdf(ikm, 32, salt, info);
    const key3 = await hkdf(ikm, 64, salt, info);

    expect(key1.length).toBe(16);
    expect(key2.length).toBe(32);
    expect(key3.length).toBe(64);

    // Derive again to verify determinism
    const key1Again = await hkdf(ikm, 16, salt, info);
    expect(key1).toEqual(key1Again);
  });
});
