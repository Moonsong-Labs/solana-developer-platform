/**
 * Gateway authorization for Private Channels reads.
 *
 * The SPC gateway JWT-gates private data (token balances, account info, tx
 * lookups). The token is minted by the SPC AUTH service (`instance.authUrl`, a
 * different service from `instance.gatewayUrl`) by logging in as the acting
 * member's SPC user — see `./spc-session`. This helper resolves that token so
 * callers can hand it to `createChannelGatewayRpc(..., { headers })`.
 *
 * Returns `undefined` when the connected instance has auth DISABLED, so
 * unauthenticated deployments keep working unchanged. When auth IS enabled the
 * caller must have a user identity and an invited membership — we fail with a
 * clear error rather than letting the gateway answer an opaque 401.
 *
 * TODO(session-cache): `getSpcSession` mints a fresh 24h JWT on every call. Once
 * the cached/persisted session lands (keyed per SPC user, refreshed before
 * expiry) it will extend that helper, so keep going through this function.
 */

import { createAuthClient } from "@sdp/private-channels/auth";
import { createPrivateChannelUserRepository } from "@/db/repositories";
import { forbidden } from "@/lib/errors";
import type { Env } from "@/types/env";
import { getSpcSession } from "./spc-session";

/** Cap below the auth client's default so a degraded auth service can't stall a request. */
const SPC_AUTH_TIMEOUT_MS = 8_000;

/** The instance fields needed to decide on, and mint, a gateway token. */
export interface GatewayAuthInstance {
  useAuth: boolean;
  /** Null/empty when the auth service isn't part of the deployment. */
  authUrl: string | null;
}

export interface ResolveGatewayAuthTokenInput {
  instance: GatewayAuthInstance;
  organizationId: string;
  projectId: string;
  /** Acting SDP user. Absent for API-key auth, which cannot mint an SPC session. */
  userId: string | null | undefined;
}

/**
 * Resolve the bearer token for gateway reads, or `undefined` when the instance
 * doesn't use auth. Throws a descriptive `FORBIDDEN` when auth is required but no
 * SPC session can be minted for the caller.
 */
export async function resolveGatewayAuthToken(
  env: Env,
  { instance, organizationId, projectId, userId }: ResolveGatewayAuthTokenInput
): Promise<string | undefined> {
  if (!instance.useAuth || !instance.authUrl) {
    return undefined; // Gateway is open on this deployment.
  }

  if (!userId) {
    throw forbidden(
      "This Private Channels instance requires authentication; reading channel data needs a user identity and is not available for API-key auth."
    );
  }

  const pcUser = await createPrivateChannelUserRepository(env).findByProjectAndUser(
    { organizationId, projectId },
    userId
  );
  if (!pcUser) {
    throw forbidden(
      "You must be an invited Private Channels member to read channel data on this instance."
    );
  }

  const client = createAuthClient(instance.authUrl, { timeoutMs: SPC_AUTH_TIMEOUT_MS });
  const { token } = await getSpcSession(env, organizationId, pcUser, client);
  return token;
}

/** Build the gateway RPC options for a (possibly absent) bearer token. */
export function gatewayAuthOptions(token: string | undefined) {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
}
