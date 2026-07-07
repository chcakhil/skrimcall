import sodium from 'libsodium-wrappers';
import { ensureReady, KeyPair } from './box';
import { RatchetState } from './doubleRatchet';

/**
 * ============================================================================
 * WHY LOCALSTORAGE IS UNSUITABLE FOR CRYPTOGRAPHIC PRIVATE KEYS:
 * ============================================================================
 * 1. Lack of Encryption: localStorage stores data as unencrypted plaintext on 
 *    the user's disk. This makes it trivial for forensic tools, local malware, 
 *    or shared device users to inspect and steal private keys.
 * 2. XSS Vulnerability: Any JavaScript executing on the page (including 
 *    compromised CDNs, rogue third-party packages, or malicious browser 
 *    extensions) has unrestricted synchronous access to window.localStorage.
 * 3. No Process Isolation: Unlike HTTP-Only cookies, there is no way to restrict 
 *    local access to localStorage; it is entirely exposed to any script context.
 * 4. Missing Transactions: localStorage is a synchronous, blocking API. It lacks
 *    transactional safety, meaning concurrent tabs can easily overwrite and 
 *    corrupt session key state.
 * 5. Size and Type Limits: It only supports strings and has a hard 5MB limit, 
 *    precluding optimal storage of raw binary buffers or large structured states.
 * 
 * Future Upgrade Note:
 * While PBKDF2 (210,000 iterations) is implemented via native subtle crypto 
 * for broad out-of-the-box browser support, transitioning to Argon2id via a 
 * WASM wrapper is a strong future upgrade to mitigate GPU-based brute force attacks.
 * ============================================================================
 */

let storageKey: CryptoKey | null = null;

export interface SerializedRatchetState {
  rootKey: string; // Base64
  sendingChainKey: string | null; // Base64
  receivingChainKey: string | null; // Base64
  sendingDHKeyPair: KeyPair;
  receivingDHPublicKey: string | null; // Base64
  sendMessageNumber: number;
  receiveMessageNumber: number;
  previousChainLength: number;
  skippedMessageKeys: [string, string][]; // [key, Base64Value]
}

interface EncryptedPayload {
  iv: string; // Base64
  ciphertext: string; // Base64
}

/**
 * Opens the browser's IndexedDB.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('skrim_secure_store', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('secure_data')) {
        db.createObjectStore('secure_data');
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Gets a record from IndexedDB.
 */
function getRecord(key: string): Promise<any> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('secure_data', 'readonly');
      const store = transaction.objectStore('secure_data');
      const request = store.get(key);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  });
}

/**
 * Puts a record into IndexedDB.
 */
function putRecord(key: string, value: any): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('secure_data', 'readwrite');
      const store = transaction.objectStore('secure_data');
      const request = store.put(value, key);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  });
}

/**
 * Clears all records from IndexedDB.
 */
function clearAllRecords(): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('secure_data', 'readwrite');
      const store = transaction.objectStore('secure_data');
      const request = store.clear();
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  });
}

/**
 * Derives a CryptoKey using PBKDF2 with SHA-256 and at least 210,000 iterations.
 */
async function deriveStorageKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 210000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data with AES-GCM using the active storage key.
 */
async function encryptData(value: any, key: CryptoKey): Promise<EncryptedPayload> {
  const text = JSON.stringify(value);
  const plaintext = new TextEncoder().encode(text);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  return {
    iv: sodium.to_base64(iv),
    ciphertext: sodium.to_base64(new Uint8Array(ciphertextBuffer))
  };
}

/**
 * Decrypts AES-GCM encrypted data using the active storage key.
 */
async function decryptData(payload: EncryptedPayload, key: CryptoKey): Promise<any> {
  const iv = sodium.from_base64(payload.iv);
  const ciphertext = sodium.from_base64(payload.ciphertext);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  const text = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(text);
}

/**
 * Serializes a complex RatchetState (rebuilding Maps and TypedArrays into JSON safe types).
 */
export function serializeRatchetState(state: RatchetState): SerializedRatchetState {
  const skipped: [string, string][] = [];
  state.skippedMessageKeys.forEach((value, key) => {
    skipped.push([key, sodium.to_base64(value)]);
  });

  return {
    rootKey: sodium.to_base64(state.rootKey),
    sendingChainKey: state.sendingChainKey ? sodium.to_base64(state.sendingChainKey) : null,
    receivingChainKey: state.receivingChainKey ? sodium.to_base64(state.receivingChainKey) : null,
    sendingDHKeyPair: state.sendingDHKeyPair,
    receivingDHPublicKey: state.receivingDHPublicKey,
    sendMessageNumber: state.sendMessageNumber,
    receiveMessageNumber: state.receiveMessageNumber,
    previousChainLength: state.previousChainLength,
    skippedMessageKeys: skipped,
  };
}

/**
 * Deserializes a SerializedRatchetState back into an operational RatchetState.
 */
export function deserializeRatchetState(serialized: SerializedRatchetState): RatchetState {
  const skippedMap = new Map<string, Uint8Array>();
  for (const [key, base64Val] of serialized.skippedMessageKeys) {
    skippedMap.set(key, sodium.from_base64(base64Val));
  }

  return {
    rootKey: sodium.from_base64(serialized.rootKey),
    sendingChainKey: serialized.sendingChainKey ? sodium.from_base64(serialized.sendingChainKey) : null,
    receivingChainKey: serialized.receivingChainKey ? sodium.from_base64(serialized.receivingChainKey) : null,
    sendingDHKeyPair: serialized.sendingDHKeyPair,
    receivingDHPublicKey: serialized.receivingDHPublicKey,
    sendMessageNumber: serialized.sendMessageNumber,
    receiveMessageNumber: serialized.receiveMessageNumber,
    previousChainLength: serialized.previousChainLength,
    skippedMessageKeys: skippedMap,
  };
}

/**
 * Unlocks the keystore by deriving the AES-GCM key from the passphrase.
 * Must be called once per app session before any key material can be accessed.
 */
export async function unlockKeyStore(passphrase: string): Promise<void> {
  await ensureReady();

  const existingSaltBase64 = await getRecord('salt') as string | undefined;

  if (!existingSaltBase64) {
    // Fresh store generation
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    await putRecord('salt', sodium.to_base64(saltBytes));

    const derivedKey = await deriveStorageKey(passphrase, saltBytes);
    
    // Create verification token
    const verificationPayload = await encryptData({ check: "valid" }, derivedKey);
    await putRecord('verification', verificationPayload);

    storageKey = derivedKey;
  } else {
    // Unlock existing store
    const saltBytes = sodium.from_base64(existingSaltBase64);
    const derivedKey = await deriveStorageKey(passphrase, saltBytes);

    const verificationPayload = await getRecord('verification') as EncryptedPayload;
    if (!verificationPayload) {
      throw new Error("Secure store is corrupted: Verification token is missing.");
    }

    try {
      const decrypted = await decryptData(verificationPayload, derivedKey);
      if (decrypted && decrypted.check === "valid") {
        storageKey = derivedKey;
      } else {
        throw new Error("Invalid passphrase or corrupted store.");
      }
    } catch {
      throw new Error("Invalid passphrase or corrupted store.");
    }
  }
}

/**
 * Saves the identity KeyPair into IndexedDB.
 */
export async function saveIdentity(identity: KeyPair): Promise<void> {
  if (!storageKey) {
    throw new Error("Key store is locked. Call unlockKeyStore first.");
  }
  const encrypted = await encryptData(identity, storageKey);
  await putRecord('identity', encrypted);
}

/**
 * Loads the identity KeyPair from IndexedDB.
 */
export async function loadIdentity(): Promise<KeyPair | null> {
  if (!storageKey) {
    throw new Error("Key store is locked. Call unlockKeyStore first.");
  }
  const encrypted = await getRecord('identity') as EncryptedPayload | undefined;
  if (!encrypted) {
    return null;
  }
  return await decryptData(encrypted, storageKey) as KeyPair;
}

/**
 * Saves a session's Double Ratchet State.
 */
export async function saveRatchetState(sessionId: string, state: RatchetState): Promise<void> {
  if (!storageKey) {
    throw new Error("Key store is locked. Call unlockKeyStore first.");
  }
  const serialized = serializeRatchetState(state);
  const encrypted = await encryptData(serialized, storageKey);
  await putRecord(`ratchet_state:${sessionId}`, encrypted);
}

/**
 * Loads a session's Double Ratchet State.
 */
export async function loadRatchetState(sessionId: string): Promise<RatchetState | null> {
  if (!storageKey) {
    throw new Error("Key store is locked. Call unlockKeyStore first.");
  }
  const encrypted = await getRecord(`ratchet_state:${sessionId}`) as EncryptedPayload | undefined;
  if (!encrypted) {
    return null;
  }
  const serialized = await decryptData(encrypted, storageKey) as SerializedRatchetState;
  return deserializeRatchetState(serialized);
}

/**
 * Locks the secure keystore.
 */
export function lockKeyStore(): void {
  storageKey = null;
}

/**
 * Checks if the secure keystore is locked.
 */
export function isKeyStoreLocked(): boolean {
  return storageKey === null;
}

/**
 * Completely wipes the secure keystore from IndexedDB.
 * Used for logout/account deletion.
 */
export async function wipeKeyStore(): Promise<void> {
  await clearAllRecords();
  storageKey = null;
}
