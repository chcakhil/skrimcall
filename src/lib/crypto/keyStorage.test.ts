import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import sodium from 'libsodium-wrappers';
import { ensureReady, KeyPair } from './box';
import { RatchetState } from './doubleRatchet';
import {
  unlockKeyStore,
  saveIdentity,
  loadIdentity,
  saveRatchetState,
  loadRatchetState,
  wipeKeyStore,
  isKeyStoreLocked,
  lockKeyStore,
} from './keyStorage';

describe('Secure KeyStorage Tests with IndexedDB', () => {
  beforeEach(async () => {
    await ensureReady();
    // Start with a clean IndexedDB state for each test
    await wipeKeyStore();
  });

  it('should prevent operations when the keystore is locked', async () => {
    expect(isKeyStoreLocked()).toBe(true);

    const dummyPair: KeyPair = { publicKey: 'abc', privateKey: 'xyz' };

    await expect(saveIdentity(dummyPair)).rejects.toThrow("Key store is locked.");
    await expect(loadIdentity()).rejects.toThrow("Key store is locked.");
  });

  it('should successfully initialize and round-trip identity keys and ratchet states', async () => {
    const passphrase = "correct_secure_passphrase_123";

    // 1. Unlock / Initialize fresh store
    await unlockKeyStore(passphrase);
    expect(isKeyStoreLocked()).toBe(false);

    // 2. Save identity KeyPair
    const identityPair: KeyPair = {
      publicKey: "MyPublicKeyBase64String==",
      privateKey: "MyPrivateKeyBase64String=="
    };
    await saveIdentity(identityPair);

    // 3. Save complex RatchetState
    const sessionState: RatchetState = {
      rootKey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]),
      sendingChainKey: new Uint8Array([32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
      receivingChainKey: null,
      sendingDHKeyPair: {
        publicKey: "SendingDHPubKeyBase64String==",
        privateKey: "SendingDHPrivKeyBase64String=="
      },
      receivingDHPublicKey: "ReceivingDHPubKeyBase64String==",
      sendMessageNumber: 42,
      receiveMessageNumber: 17,
      previousChainLength: 5,
      skippedMessageKeys: new Map<string, Uint8Array>([
        ['key_alice_msg_1', new Uint8Array([10, 20, 30])],
        ['key_alice_msg_2', new Uint8Array([40, 50, 60])]
      ])
    };

    const sessionId = "session_alice_bob_001";
    await saveRatchetState(sessionId, sessionState);

    // 4. Load identity back and verify
    const loadedIdentity = await loadIdentity();
    expect(loadedIdentity).toEqual(identityPair);

    // 5. Load ratchet state back and verify
    const loadedState = await loadRatchetState(sessionId);
    expect(loadedState).not.toBeNull();
    if (loadedState) {
      expect(loadedState.rootKey).toEqual(sessionState.rootKey);
      expect(loadedState.sendingChainKey).toEqual(sessionState.sendingChainKey);
      expect(loadedState.receivingChainKey).toBeNull();
      expect(loadedState.sendingDHKeyPair).toEqual(sessionState.sendingDHKeyPair);
      expect(loadedState.receivingDHPublicKey).toBe(sessionState.receivingDHPublicKey);
      expect(loadedState.sendMessageNumber).toBe(42);
      expect(loadedState.receiveMessageNumber).toBe(17);
      expect(loadedState.previousChainLength).toBe(5);

      // Verify the map structure survived encryption/decryption
      expect(loadedState.skippedMessageKeys instanceof Map).toBe(true);
      expect(loadedState.skippedMessageKeys.size).toBe(2);
      expect(loadedState.skippedMessageKeys.get('key_alice_msg_1')).toEqual(new Uint8Array([10, 20, 30]));
      expect(loadedState.skippedMessageKeys.get('key_alice_msg_2')).toEqual(new Uint8Array([40, 50, 60]));
    }
  });

  it('should allow locking and re-unlocking with the correct passphrase', async () => {
    const passphrase = "another_good_passcode";

    // 1. Initial setup
    await unlockKeyStore(passphrase);
    const identityPair: KeyPair = { publicKey: "pub", privateKey: "priv" };
    await saveIdentity(identityPair);

    // 2. Lock
    lockKeyStore();
    expect(isKeyStoreLocked()).toBe(true);
    await expect(loadIdentity()).rejects.toThrow();

    // 3. Unlock with correct passphrase
    await unlockKeyStore(passphrase);
    expect(isKeyStoreLocked()).toBe(false);

    const loaded = await loadIdentity();
    expect(loaded).toEqual(identityPair);
  });

  it('should throw an error and refuse access when an incorrect passphrase is used to unlock', async () => {
    const passphrase = "correct_passcode";

    // Initialize with correct passphrase
    await unlockKeyStore(passphrase);
    await saveIdentity({ publicKey: "p", privateKey: "v" });

    // Lock store
    lockKeyStore();

    // Try to unlock with incorrect passphrase
    await expect(
      unlockKeyStore("incorrect_passcode")
    ).rejects.toThrow("Invalid passphrase or corrupted store.");

    // Keystore should remain locked
    expect(isKeyStoreLocked()).toBe(true);
  });

  it('should lock and completely remove all database entries on wipeKeyStore()', async () => {
    const passphrase = "wipe_test_passphrase";

    await unlockKeyStore(passphrase);
    await saveIdentity({ publicKey: "wipe_p", privateKey: "wipe_v" });
    await saveRatchetState("s1", {
      rootKey: new Uint8Array(32),
      sendingChainKey: null,
      receivingChainKey: null,
      sendingDHKeyPair: { publicKey: "a", privateKey: "b" },
      receivingDHPublicKey: null,
      sendMessageNumber: 0,
      receiveMessageNumber: 0,
      previousChainLength: 0,
      skippedMessageKeys: new Map()
    });

    // Wipe store
    await wipeKeyStore();
    expect(isKeyStoreLocked()).toBe(true);

    // Unlocking as a fresh store again (which will succeed with any password now since salt/verification were wiped)
    await unlockKeyStore("brand_new_passphrase");
    
    // Loaded records should now be missing (return null)
    const identity = await loadIdentity();
    expect(identity).toBeNull();

    const state = await loadRatchetState("s1");
    expect(state).toBeNull();
  });
});
