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
import {
  createPrivateChannelInstanceRepository,
  createPrivateChannelUserRepository,
  createPrivateChannelVerifiedWalletRepository,
} from "@/db/repositories";
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

/**
 * Outcome of resolving gateway auth for a background job, which — unlike a request
 * — has no user to attribute the read to and must not throw on a missing identity
 * (it would just re-throw every cron tick).
 */
export type OwnerGatewayAuth =
  | { kind: "open" }
  | { kind: "token"; token: string }
  | { kind: "unavailable"; reason: string };

export interface ResolveOwnerGatewayAuthInput {
  organizationId: string;
  projectId: string;
  /** The deposit's persisted instance (auth config is read from the CURRENT row). */
  instanceId: string;
  /** On-chain address whose balance is being read (the credit recipient). */
  owner: string;
}

/**
 * Resolve gateway auth for a background job from an on-chain address alone.
 *
 * The cron has no request user, so it derives an SPC identity from the data: the
 * owner pubkey must have been VERIFIED by a member ON THIS INSTANCE, which maps
 * `(instance_id, pubkey) → private_channel_verified_wallets.user_id →
 * private_channel_users` — the member whose SPC credential can mint a token. Reading a member's own balance
 * under their own SPC identity is the natural attribution.
 *
 * Returns `unavailable` (never throws) when no identity can be derived — e.g. the
 * recipient is an external/unverified address. The caller should skip that group
 * and leave the deposits for manual resolution rather than fail the whole tick.
 *
 * NOTE: `use_auth`/`auth_url` come from the instance's CURRENT row, not the
 * deposit's snapshot (the snapshot pins the chain/gateway, and carries no auth
 * endpoint). Authenticating against the current auth service is the desired
 * behaviour; if that ever needs pinning too, add it to the snapshot.
 */
export async function resolveOwnerGatewayAuth(
  env: Env,
  { organizationId, projectId, instanceId, owner }: ResolveOwnerGatewayAuthInput
): Promise<OwnerGatewayAuth> {
  const instance = await createPrivateChannelInstanceRepository(env).getById(instanceId);
  if (!instance) {
    return { kind: "unavailable", reason: `instance ${instanceId} no longer exists` };
  }
  if (!instance.use_auth || !instance.auth_url) {
    return { kind: "open" };
  }

  const scope = { organizationId, projectId };
  // Verifications are INSTANCE-scoped (uniqueness is user_id + instance_id + pubkey),
  // so resolve the owner against the deposit's own instance.
  const verified = await createPrivateChannelVerifiedWalletRepository(env).findByInstanceAndPubkey(
    instanceId,
    owner
  );
  if (!verified) {
    return {
      kind: "unavailable",
      reason: `no verified wallet maps ${owner} to a Private Channels member`,
    };
  }

  const pcUser = await createPrivateChannelUserRepository(env).getById(scope, verified.user_id);
  if (!pcUser) {
    return { kind: "unavailable", reason: `member ${verified.user_id} no longer exists` };
  }

  try {
    const client = createAuthClient(instance.auth_url, { timeoutMs: SPC_AUTH_TIMEOUT_MS });
    const { token } = await getSpcSession(env, organizationId, pcUser, client);
    return { kind: "token", token };
  } catch (error) {
    return {
      kind: "unavailable",
      reason: `SPC login failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
