/**
 * SPC JWT session layer for Private Channels.
 *
 * The same bearer token (minted by the SPC AUTH service at `instance.authUrl`)
 * gates both Auth REST (challenge/verify/delete) and Gateway JSON-RPC (balances,
 * burns, tx lookups). See `./spc-session` for KV caching per (instance, SPC user).
 *
 * Callers hold an `SpcAuthContext` and run work through `withGatewayRpc` or
 * `withSpcAuth`, each of which retries ONCE on a strict 401 with a re-minted
 * token. Returns `undefined` from `resolveGatewayAuth` when the instance has
 * auth DISABLED. When auth IS enabled the caller must have a user identity and
 * an invited membership — we fail with a clear error rather than an opaque 401.
 */

import { createChannelGatewayRpc, PrivateChannelError } from "@sdp/private-channels";
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
 * A live SPC bearer token that can re-mint itself. `current` is the token to
 * send; `refresh()` re-logins (evicting the cached entry) and updates `current`.
 * `undefined` in place of a context (from `resolveGatewayAuth`) means the
 * instance is open (no auth).
 */
export interface SpcAuthContext {
  current: string;
  refresh(): Promise<string>;
}

export interface ResolveGatewayAuthInput {
  instance: GatewayAuthInstance;
  organizationId: string;
  projectId: string;
  /** Acting SDP user. Absent for API-key auth, which cannot mint an SPC session. */
  userId: string | null | undefined;
}

/** Best-effort KV `cache` store; `undefined` when KV isn't configured on this runtime. */
function tryGetCache(env: Env) {
  try {
    return createKVStoreSet(env).cache;
  } catch {
    return undefined; // No KV binding → no caching, fall back to fresh login each call.
  }
}

/**
 * Mint the initial SPC token through the KV read-through cache and wrap it in a
 * self-refreshing context. `refresh()` calls only `getSpcSession(forceRefresh)` —
 * it must NOT re-run membership/identity checks, or it would re-throw
 * `forbidden` instead of re-logging in.
 */
export async function openSpcAuthContext(
  env: Env,
  organizationId: string,
  instanceId: string,
  pcUser: PrivateChannelUserRow,
  client: SpcAuthClient
): Promise<SpcAuthContext> {
  const cache = tryGetCache(env);
  const session = (forceRefresh: boolean) =>
    getSpcSession(env, organizationId, pcUser, client, { cache, instanceId, forceRefresh });
  const { token } = await session(false);
  const context: SpcAuthContext = {
    current: token,
    refresh: async () => (context.current = (await session(true)).token),
  };
  return context;
}

/**
 * Resolve an SPC auth context for a request, or `undefined` when the instance
 * doesn't use auth. Throws a descriptive `FORBIDDEN` when auth is required but no
 * SPC session can be minted for the caller.
 */
export async function resolveGatewayAuth(
  env: Env,
  { instance, organizationId, projectId, userId }: ResolveGatewayAuthInput
): Promise<SpcAuthContext | undefined> {
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
  return openSpcAuthContext(env, organizationId, instance.id, pcUser, client);
}

/** Build the gateway RPC options for a (possibly absent) bearer token. */
function gatewayAuthOptions(token: string | undefined) {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
}

function isUnauthorizedAuthError(error: unknown): boolean {
  return error instanceof PrivateChannelError && error.code === "UNAUTHORIZED";
}

/**
 * Run a gateway RPC op with a context's token, retrying ONCE on a gateway 401 with a
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
  context: SpcAuthContext | undefined,
  run: (rpc: SolanaRpc) => Promise<T>
): Promise<T> {
  const attempt = (token: string | undefined) =>
    run(createChannelGatewayRpc(env, gatewayUrl, gatewayAuthOptions(token)));
  try {
    return await attempt(context?.current);
  } catch (error) {
    if (!context || !isUnauthorizedRpcError(error)) {
      throw error;
    }
    return await attempt(await context.refresh());
  }
}

/**
 * Run an Auth REST op with a context's token, retrying ONCE on
 * `PrivateChannelError` code `UNAUTHORIZED` (HTTP 401) with a re-minted token.
 *
 * `run` must be the token-authenticated Auth sequence ONLY. For wallet verify the
 * unit is challenge → sign → verify (restarted from challenge on 401) because the
 * nonce is challenge-scoped. A still-401 second attempt propagates; a `refresh()`
 * failure surfaces instead of the original 401.
 */
export async function withSpcAuth<T>(
  context: SpcAuthContext,
  run: (token: string) => Promise<T>
): Promise<T> {
  try {
    return await run(context.current);
  } catch (error) {
    if (!isUnauthorizedAuthError(error)) {
      throw error;
    }
    return await run(await context.refresh());
  }
}

/**
 * Outcome of resolving gateway auth for a background job, which — unlike a request
 * — has no user to attribute the read to and must not throw on a missing identity
 * (it would just re-throw every cron tick).
 */
export type OwnerGatewayAuth =
  | { kind: "open" }
  | { kind: "token"; context: SpcAuthContext }
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
    return {
      kind: "token",
      context: await openSpcAuthContext(env, organizationId, instanceId, pcUser, client),
    };
  } catch (error) {
    return {
      kind: "unavailable",
      reason: `SPC login failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
