/**
 * Gateway authorization for Private Channels reads and writes.
 *
 * The SPC gateway JWT-gates private data (token balances, account info, tx
 * lookups, burn broadcast). The token is minted by the SPC AUTH service
 * (`instance.authUrl`, a different service from `instance.gatewayUrl`) by logging
 * in as the acting member's SPC user — see `./spc-session`, which caches it per
 * (instance, SPC user) in KV and refreshes before expiry.
 *
 * Callers do not hold a bare token; they hold a `GatewayAuthHandle` and run their
 * gateway op through `withGatewayRpc`, which retries ONCE on a gateway 401 with a
 * re-minted token. Returns `undefined` when the connected instance has auth
 * DISABLED, so unauthenticated deployments keep working unchanged. When auth IS
 * enabled the caller must have a user identity and an invited membership — we fail
 * with a clear error rather than letting the gateway answer an opaque 401.
 */

import { createChannelGatewayRpc } from "@sdp/private-channels";
import { createAuthClient, type SpcAuthClient } from "@sdp/private-channels/auth";
import { isUnauthorizedRpcError } from "@sdp/rpc";
import type { SolanaRpc } from "@sdp/rpc/solana";
import {
  createPrivateChannelInstanceRepository,
  createPrivateChannelUserRepository,
  createPrivateChannelVerifiedWalletRepository,
  type PrivateChannelUserRow,
} from "@/db/repositories";
import { forbidden } from "@/lib/errors";
import { createKVStoreSet } from "@/runtime/factory";
import type { KVStore } from "@/runtime/kv";
import type { Env } from "@/types/env";
import { getSpcSession } from "./spc-session";

/** Cap below the auth client's default so a degraded auth service can't stall a request. */
const SPC_AUTH_TIMEOUT_MS = 8_000;

/** The instance fields needed to decide on, and mint, a gateway token. */
export interface GatewayAuthInstance {
  /** Instance id — the SPC-session cache is scoped per (instance, SPC user). */
  id: string;
  useAuth: boolean;
  /** Null/empty when the auth service isn't part of the deployment. */
  authUrl: string | null;
}

/**
 * A live gateway bearer token that can re-mint itself. `current` is the token to
 * send; `refresh()` re-logins (evicting the cached entry) and updates `current`.
 * `undefined` in place of a handle means the instance is open (no auth).
 */
export interface GatewayAuthHandle {
  current: string | undefined;
  refresh(): Promise<string | undefined>;
}

export interface ResolveGatewayAuthInput {
  instance: GatewayAuthInstance;
  organizationId: string;
  projectId: string;
  /** Acting SDP user. Absent for API-key auth, which cannot mint an SPC session. */
  userId: string | null | undefined;
}

/** Best-effort KV `cache` store; `undefined` when KV isn't configured on this runtime. */
function tryGetCache(env: Env): KVStore | undefined {
  try {
    return createKVStoreSet(env).cache;
  } catch {
    return undefined; // No KV binding → no caching, fall back to fresh login each call.
  }
}

/**
 * Mint the initial SPC token and wrap it in a self-refreshing handle. `refresh()`
 * calls only `getSpcSession(forceRefresh)` — it must NOT re-run the membership/identity
 * checks, or it would re-throw `forbidden` instead of re-logging in.
 */
async function openGatewayAuthHandle(
  env: Env,
  organizationId: string,
  instanceId: string,
  pcUser: PrivateChannelUserRow,
  client: SpcAuthClient,
  cache: KVStore | undefined
): Promise<GatewayAuthHandle> {
  const session = (forceRefresh: boolean) =>
    getSpcSession(env, organizationId, pcUser, client, { cache, instanceId, forceRefresh });
  const { token } = await session(false);
  const handle: GatewayAuthHandle = {
    current: token,
    refresh: async () => (handle.current = (await session(true)).token),
  };
  return handle;
}

/**
 * Resolve a gateway auth handle for a request, or `undefined` when the instance
 * doesn't use auth. Throws a descriptive `FORBIDDEN` when auth is required but no
 * SPC session can be minted for the caller.
 */
export async function resolveGatewayAuth(
  env: Env,
  { instance, organizationId, projectId, userId }: ResolveGatewayAuthInput
): Promise<GatewayAuthHandle | undefined> {
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
  const cache = tryGetCache(env);
  return openGatewayAuthHandle(env, organizationId, instance.id, pcUser, client, cache);
}

/** Build the gateway RPC options for a (possibly absent) bearer token. */
function gatewayAuthOptions(token: string | undefined) {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
}

/**
 * Run a gateway RPC op with a handle's token, retrying ONCE on a gateway 401 with a
 * re-minted token and a rebuilt client (the token is baked into headers at
 * construction, so a rebuild is required).
 *
 * `run` must be the token-authenticated gateway sequence ONLY, never surrounding
 * business logic — on the withdrawal write path this re-runs a burn broadcast. That
 * is safe because `isUnauthorizedRpcError` is strict (status 401 only): a 401 is an
 * auth-middleware rejection BEFORE the gateway forwards the tx, so nothing reached
 * the channel chain and re-running (with a fresh blockhash) cannot double-burn.
 *
 * A refreshed-but-still-401 propagates (no loop). If `refresh()` itself throws (login
 * 401 / auth unavailable), that error surfaces — it is more actionable than the 401.
 */
export async function withGatewayRpc<T>(
  env: Env,
  gatewayUrl: string,
  handle: GatewayAuthHandle | undefined,
  run: (rpc: SolanaRpc) => Promise<T>
): Promise<T> {
  const attempt = (token: string | undefined) =>
    run(createChannelGatewayRpc(env, gatewayUrl, gatewayAuthOptions(token)));
  try {
    return await attempt(handle?.current);
  } catch (error) {
    if (!handle?.current || !isUnauthorizedRpcError(error)) {
      throw error;
    }
    return await attempt(await handle.refresh());
  }
}

/**
 * Outcome of resolving gateway auth for a background job, which — unlike a request
 * — has no user to attribute the read to and must not throw on a missing identity
 * (it would just re-throw every cron tick).
 */
export type OwnerGatewayAuth =
  | { kind: "open" }
  | { kind: "token"; handle: GatewayAuthHandle }
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
    const cache = tryGetCache(env);
    return {
      kind: "token",
      handle: await openGatewayAuthHandle(env, organizationId, instanceId, pcUser, client, cache),
    };
  } catch (error) {
    return {
      kind: "unavailable",
      reason: `SPC login failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
