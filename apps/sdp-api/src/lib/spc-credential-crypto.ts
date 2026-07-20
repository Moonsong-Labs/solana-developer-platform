// Thin wrapper that reuses EncryptionService (AES-GCM + HKDF per org) with the
// SPC-specific master key. Kept separate from the custody encryption key so
// compromise of one doesn't leak the other.

import { EncryptionError, EncryptionService } from "@/services/encryption.service";
import type { Env } from "@/types/env";

export function createSpcCredentialEncryption(
  env: Pick<Env, "SPC_CREDENTIAL_ENCRYPTION_KEY">
): EncryptionService {
  const key = env.SPC_CREDENTIAL_ENCRYPTION_KEY;
  if (!key) {
    throw new EncryptionError(
      "SPC_CREDENTIAL_ENCRYPTION_KEY environment variable is not configured"
    );
  }
  return new EncryptionService({ masterKey: key });
}
