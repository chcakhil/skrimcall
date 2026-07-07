import { describe, it, expect } from 'vitest';
import { ensureReady } from './box';
import {
  createGroupSession,
  generateSenderKeyDistributionPayload,
  addSenderKeyFromPeer,
  rotateGroupKeyOnMemberLeave,
  encryptGroupMessage,
  decryptGroupMessage,
} from './senderKeys';

describe('Group Messaging (Sender Keys) Encryption Tests', () => {
  it('should successfully support a 3-person group conversation (Alice, Bob, Charlie)', async () => {
    await ensureReady();

    // 1. Initialize sessions
    const aliceSession = await createGroupSession('group1', 'alice');
    const bobSession = await createGroupSession('group1', 'bob');
    const charlieSession = await createGroupSession('group1', 'charlie');

    // 2. Distribute Alice's key
    const alicePayload = generateSenderKeyDistributionPayload(aliceSession);
    await addSenderKeyFromPeer(bobSession, 'alice', alicePayload);
    await addSenderKeyFromPeer(charlieSession, 'alice', alicePayload);

    // 3. Distribute Bob's key
    const bobPayload = generateSenderKeyDistributionPayload(bobSession);
    await addSenderKeyFromPeer(aliceSession, 'bob', bobPayload);
    await addSenderKeyFromPeer(charlieSession, 'bob', bobPayload);

    // 4. Distribute Charlie's key
    const charliePayload = generateSenderKeyDistributionPayload(charlieSession);
    await addSenderKeyFromPeer(aliceSession, 'charlie', charliePayload);
    await addSenderKeyFromPeer(bobSession, 'charlie', charliePayload);

    // Alice -> Group
    const msg1 = await encryptGroupMessage(aliceSession, "Hello everyone! Alice here.");
    const dec1Bob = await decryptGroupMessage(bobSession, 'alice', msg1);
    const dec1Charlie = await decryptGroupMessage(charlieSession, 'alice', msg1);
    expect(dec1Bob).toBe("Hello everyone! Alice here.");
    expect(dec1Charlie).toBe("Hello everyone! Alice here.");

    // Bob -> Group
    const msg2 = await encryptGroupMessage(bobSession, "Hey Alice, this is Bob!");
    const dec2Alice = await decryptGroupMessage(aliceSession, 'bob', msg2);
    const dec2Charlie = await decryptGroupMessage(charlieSession, 'bob', msg2);
    expect(dec2Alice).toBe("Hey Alice, this is Bob!");
    expect(dec2Charlie).toBe("Hey Alice, this is Bob!");
  });

  it('should prevent a 4th joining member (Dave) from decrypting earlier messages (Forward Secrecy / Pre-Join isolation)', async () => {
    await ensureReady();

    // Alice and Bob start
    const aliceSession = await createGroupSession('group1', 'alice');
    const bobSession = await createGroupSession('group1', 'bob');

    const alicePayload1 = generateSenderKeyDistributionPayload(aliceSession);
    await addSenderKeyFromPeer(bobSession, 'alice', alicePayload1);

    // Alice sends a message before Dave joins
    const msgBeforeDave = await encryptGroupMessage(aliceSession, "Super secret archive message");

    // Dave joins
    const daveSession = await createGroupSession('group1', 'dave');

    // Alice sends Dave her CURRENT distribution payload (post-encryption)
    const alicePayload2 = generateSenderKeyDistributionPayload(aliceSession);
    await addSenderKeyFromPeer(daveSession, 'alice', alicePayload2);

    // Dave attempts to decrypt the earlier message
    await expect(
      decryptGroupMessage(daveSession, 'alice', msgBeforeDave)
    ).rejects.toThrow();
  });

  it('should prevent a leaving member (Bob) from decrypting messages sent after they left (Post-Leave isolation)', async () => {
    await ensureReady();

    const aliceSession = await createGroupSession('group1', 'alice');
    const bobSession = await createGroupSession('group1', 'bob');
    const charlieSession = await createGroupSession('group1', 'charlie');

    // Complete mesh setup
    const alicePayload = generateSenderKeyDistributionPayload(aliceSession);
    await addSenderKeyFromPeer(bobSession, 'alice', alicePayload);
    await addSenderKeyFromPeer(charlieSession, 'alice', alicePayload);

    const bobPayload = generateSenderKeyDistributionPayload(bobSession);
    await addSenderKeyFromPeer(aliceSession, 'bob', bobPayload);
    await addSenderKeyFromPeer(charlieSession, 'bob', bobPayload);

    const charliePayload = generateSenderKeyDistributionPayload(charlieSession);
    await addSenderKeyFromPeer(aliceSession, 'charlie', charliePayload);
    await addSenderKeyFromPeer(bobSession, 'charlie', charliePayload);

    // Bob leaves the group.
    // Remaining members (Alice and Charlie) rotate their keys to revoke Bob's access
    const newAlicePayload = await rotateGroupKeyOnMemberLeave(aliceSession);
    await addSenderKeyFromPeer(charlieSession, 'alice', newAlicePayload);
    // Since Bob left, we do NOT share the rotated payload with Bob.

    const newCharliePayload = await rotateGroupKeyOnMemberLeave(charlieSession);
    await addSenderKeyFromPeer(aliceSession, 'charlie', newCharliePayload);

    // Alice sends a message to the group now
    const msgAfterBobLeft = await encryptGroupMessage(aliceSession, "Bob has left, we can talk freely.");

    // Charlie can decrypt successfully
    const decCharlie = await decryptGroupMessage(charlieSession, 'alice', msgAfterBobLeft);
    expect(decCharlie).toBe("Bob has left, we can talk freely.");

    // Bob tries to decrypt but fails because his key for Alice was not rotated and he does not have the new key ID
    await expect(
      decryptGroupMessage(bobSession, 'alice', msgAfterBobLeft)
    ).rejects.toThrow();
  });
});
