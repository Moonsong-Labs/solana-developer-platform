// SPC session: mint a JWT for an invited member's SPC user.
//
// The SDP user never types SPC credentials. When the member was invited (#7),
// SDP generated an SPC password and stored it encrypted on the
// private_channel_users row. Here we decrypt it and log in on the member's
// behalf to obtain the SPC-issued JWT that gates the wallet APIs.
//
// SIMPLE FOR NOW: a fresh login on every call — no caching, no reuse across
// requests, no refresh. The reusable, KV-cached session infrastructure is for a
// separate PR; it will extend THIS helper, so callers should keep going
// through it rather than calling `login` directly.

import { PrivateChannelError } from "@sdp/private-channels";
import type { SpcAuthClient } from "@sdp/private-channels/auth";
import type { PrivateChannelUserRow } from "@/db/repositories";
import { createSpcCredentialEncryption } from "@/lib/spc-credential-crypto";
import type { Env } from "@/types/env";

export interface SpcSession {
  /** SPC-issued JWT (24h) for challenge/verify/list/delete calls. */
  token: string;
  /** The SPC username the wallet is verified under. */
  username: string;
}

/**
 * Obtain an SPC JWT for a member's SPC user by decrypting their stored
 * credential and logging in. Throws `FORBIDDEN` if the member has no SPC
 * credential (not fully provisioned).
 */
export async function getSpcSession(
  env: Env,
  organizationId: string,
  pcUser: PrivateChannelUserRow,
  authClient: SpcAuthClient
): Promise<SpcSession> {
  if (!pcUser.spc_username || !pcUser.spc_credential_ciphertext) {
    throw new PrivateChannelError(
      "FORBIDDEN",
      "Your Private Channels membership has no SPC credential; ask an admin to re-invite you."
    );
  }

  const password = await createSpcCredentialEncryption(env).decrypt(
    organizationId,
    pcUser.spc_credential_ciphertext
  );
  const { token } = await authClient.login({ username: pcUser.spc_username, password });
  return { token, username: pcUser.spc_username };
}
