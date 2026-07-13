/**
 * SPC gateway leg.
 *
 * The gateway is Solana-JSON-RPC-compatible, so this reuses `@sdp/rpc/solana`'s
 * `createRpc({rpcUrl,headers})` verbatim — no bespoke gateway client. The Bearer
 * header path is wired for the future auth-ON (RBAC) mode; auth is OFF on the
 * sandbox today, so the token is accepted but not enforced.
 */

import type { RpcEnv } from "@sdp/rpc";
import {
  confirmTransaction,
  createRpc,
  type Signature,
  type SolanaRpc,
  sendTransaction,
} from "@sdp/rpc/solana";
import type {
  PrivateChannelConfig,
  PrivateChannelNetwork,
  PrivateChannelTransferReceipt,
} from "./types";

/**
 * Build the `RpcEnv` for a channel/L1 endpoint. `createRpc` calls
 * `getSolanaConfig` unconditionally (which requires a resolvable URL) before
 * applying the per-call `rpcUrl` override, so we seed `SOLANA_RPC_URL` with the
 * same URL.
 */
export function toRpcEnv(url: string, network: PrivateChannelNetwork): RpcEnv {
  return { SOLANA_RPC_URL: url, SOLANA_NETWORK: network };
}

/** SDP's own RPC client pointed at the SPC gateway, optional Bearer for auth-ON. */
export function createGatewayRpc(
  config: PrivateChannelConfig,
  options?: { bearer?: string }
): SolanaRpc {
  const bearer = options?.bearer?.trim();
  return createRpc(toRpcEnv(config.gatewayUrl, config.network), {
    rpcUrl: config.gatewayUrl,
    ...(bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {}),
  });
}

/**
 * Submit a signed transaction to the gateway. The gateway runs no preflight, so
 * `skipPreflight` is set.
 */
export function submitToGateway(rpc: SolanaRpc, signedTx: Uint8Array): Promise<Signature> {
  return sendTransaction(rpc, signedTx, { skipPreflight: true });
}

/**
 * Poll a signature to finality. The channel has a single linear timeline, so
 * `getSignatureStatuses` returns `Finalized` (or not-found) with no
 * intermediate state; `confirmTransaction` treats finalized as satisfying
 * `confirmed`.
 */
export async function awaitFinalized(
  rpc: SolanaRpc,
  signature: Signature,
  options?: { timeoutMs?: number }
): Promise<PrivateChannelTransferReceipt> {
  const confirmation = await confirmTransaction(rpc, signature, {
    commitment: "confirmed",
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return {
    signature: confirmation.signature,
    slot: confirmation.slot,
    confirmationStatus: confirmation.confirmationStatus,
  };
}
