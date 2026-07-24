// Cipher for the SPC passwords SDP issues on behalf of invited members.
//
// Shares the custody cipher router — legacy AES-GCM, or Cloud KMS envelope
// encryption (`v2.` prefix) once SPC_CREDENTIAL_KMS_KEY_NAME is set — but under
// its OWN keys, deliberately:
//
//   * blast radius: compromising the custody key must not expose SPC
//     credentials, and vice versa;
//   * recoverability differs. Custody keys are irreplaceable — lose them and
//     wallet control is gone. An SPC password is re-issuable: `inviteMember`
//     generates it and registers it with SPC, and the member never sees it, so
//     an unreadable credential is repaired by re-inviting.
//
// Decryption dispatches on the ciphertext prefix, so rows written under the
// legacy key keep working after a KMS key is introduced.

import { type CustodyCipher, createCipherRouter } from "@/services/custody-cipher/cipher-router";
import { EncryptionError } from "@/services/encryption.service";
import type { Env } from "@/types/env";

export function createSpcCredentialCipher(
  env: Pick<
    Env,
    | "SPC_CREDENTIAL_ENCRYPTION_KEY"
    | "SPC_CREDENTIAL_KMS_KEY_NAME"
    | "CUSTODY_KMS_API_BASE_URL"
    | "CUSTODY_KMS_METADATA_TOKEN_URL"
  >
): CustodyCipher {
  const legacyKey = env.SPC_CREDENTIAL_ENCRYPTION_KEY;
  const kmsKeyName = env.SPC_CREDENTIAL_KMS_KEY_NAME;
  // Fail fast rather than at the first encrypt/decrypt: neither key configured
  // means Private Channels invites cannot work at all.
  if (!legacyKey && !kmsKeyName) {
    throw new EncryptionError(
      "SPC_CREDENTIAL_ENCRYPTION_KEY environment variable is not configured"
    );
  }
  return createCipherRouter(env, { legacyKey, kmsKeyName });
}
