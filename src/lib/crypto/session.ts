import { aliceX3DH, bobX3DH, BobPrekeyBundle } from './keyExchange';
import { initRatchet, ratchetEncrypt, ratchetDecrypt, RatchetState, EncryptedMessage } from './doubleRatchet';
import { KeyPair } from './box';

export interface InitiatorConfig {
  isInitiator: true;
  myIdentityKeyPair: KeyPair;
  myEphemeralKeyPair: KeyPair;
  theirPrekeyBundle: BobPrekeyBundle;
}

export interface ResponderConfig {
  isInitiator: false;
  myIdentityKeyPair: KeyPair;
  mySignedPrekey: KeyPair;
  myOneTimePrekey: KeyPair | null;
  theirIdentityPublicKey: string;
  theirEphemeralPublicKey: string;
}

export type SessionConfig = InitiatorConfig | ResponderConfig;

/**
 * High-level secure session initiator.
 * Automatically performs X3DH key exchange and initializes the Double Ratchet state machine.
 */
export async function initSecureSession(config: SessionConfig): Promise<RatchetState> {
  if (config.isInitiator) {
    const sharedSecret = await aliceX3DH(
      config.myIdentityKeyPair,
      config.myEphemeralKeyPair,
      config.theirPrekeyBundle
    );
    return initRatchet(sharedSecret, true, config.theirPrekeyBundle.signedPrekey);
  } else {
    const responder = config as ResponderConfig;
    const sharedSecret = await bobX3DH(
      responder.myIdentityKeyPair,
      responder.mySignedPrekey,
      responder.myOneTimePrekey,
      responder.theirIdentityPublicKey,
      responder.theirEphemeralPublicKey
    );
    const state = await initRatchet(sharedSecret, false);
    // Bind Bob's sending ratchet key to be his signed prekey for the first inbound DH ratchet
    state.sendingDHKeyPair = responder.mySignedPrekey;
    return state;
  }
}

/**
 * Encrypts a plaintext message for a given secure session.
 */
export async function encryptMessage(state: RatchetState, plaintext: string): Promise<EncryptedMessage> {
  return ratchetEncrypt(state, plaintext);
}

/**
 * Decrypts an encrypted message for a given secure session.
 */
export async function decryptMessage(
  state: RatchetState,
  header: {
    dhPublicKey: string;
    messageNumber: number;
    previousChainLength: number;
  },
  ciphertext: string
): Promise<string> {
  return ratchetDecrypt(state, header, ciphertext);
}
