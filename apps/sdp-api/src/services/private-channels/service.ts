/**
 * Private-channels domain service.
 *
 * Orchestrates the `@sdp/private-channels` transport client with SDP-owned
 * concerns: custody signer resolution (`createOrgSigner`) and instance config.
 * Signing is server-side custody; the library stays signer-agnostic.
 *
 * App-owned concerns (custody, DB-backed reconciliation, allowed-mint mirroring)
 * are orchestrated here rather than in the transport package.
 */

import {
  createGatewayRpc,
  executeInternalTransfer,
  type GatewayHealthResult,
  getChannelBalance,
  getChannelBalances,
  type PrivateChannelBalanceRaw,
  type PrivateChannelConfig,
  PrivateChannelError,
  probeGatewayHealth,
  resolveTokenProgram,
} from "@sdp/private-channels";
import { parseDecimalAmount } from "@sdp/solana/amount";
import type {
  PrivateChannelBalance,
  PrivateChannelHealth,
  PrivateChannelInstanceInfo,
  PrivateChannelTransferResult,
} from "@sdp/types";
import type { Address } from "@solana/kit";
import { createOrgSigner } from "@/services/solana";
import type { Env } from "@/types/env";
import { getPrivateChannelConfig } from "./config";

/** Map an engine `PrivateChannelBalanceRaw` (bigint) to the JSON-safe wire DTO (strings). */
function toBalanceDto(balance: PrivateChannelBalanceRaw): PrivateChannelBalance {
  return {
    wallet: balance.wallet,
    mint: balance.mint,
    tokenProgram: balance.tokenProgram,
    ata: balance.ata,
    amount: balance.amount.toString(),
    uiAmount: balance.uiAmount,
    decimals: balance.decimals,
    exists: balance.exists,
  };
}

/** Connect + health snapshot for the configured SPC instance. */
export async function getInstanceInfo(env: Env): Promise<PrivateChannelInstanceInfo> {
  const config = getPrivateChannelConfig(env);
  const health = await probeGatewayHealth(config.gatewayUrl);

  return {
    gatewayUrl: config.gatewayUrl,
    authMode: config.authMode,
    network: config.network,
    healthy: health.health?.ok === true,
    ready: health.ready?.ok === true,
    ...(config.escrowProgramId ? { escrowProgramId: config.escrowProgramId } : {}),
    ...(config.withdrawProgramId ? { withdrawProgramId: config.withdrawProgramId } : {}),
    ...(config.escrowInstance ? { escrowInstance: config.escrowInstance } : {}),
    ...(config.usdcMint ? { usdcMint: config.usdcMint } : {}),
  };
}

/** Map the engine probe result to the JSON-safe wire DTO (drops sub-responses). */
function toHealthDto(result: GatewayHealthResult): PrivateChannelHealth {
  if (result.status === "degraded") {
    return { status: "degraded", latencyMs: result.latencyMs, reason: result.reason };
  }
  if (result.status === "unreachable") {
    return { status: "unreachable", latencyMs: result.latencyMs, error: result.error };
  }
  return { status: "ready", latencyMs: result.latencyMs };
}

/** Probe a candidate gateway URL (the connect-form pre-connect test) → wire DTO. */
export async function probeInstanceHealth(gatewayUrl: string): Promise<PrivateChannelHealth> {
  return toHealthDto(await probeGatewayHealth(gatewayUrl));
}

/** Read channel balances for a wallet across a caller-supplied mint set. */
export async function getWalletChannelBalances(
  config: PrivateChannelConfig,
  params: { wallet: Address; mints: Address[] }
): Promise<PrivateChannelBalance[]> {
  const rpc = createGatewayRpc(config);
  const balances = await getChannelBalances(
    rpc,
    params.mints.map((mint) => ({ wallet: params.wallet, mint }))
  );
  return balances.map(toBalanceDto);
}

/** Inputs for {@link executeChannelTransfer}. */
export interface ExecuteChannelTransferParams {
  /** Caller's organization scope (for custody signer resolution). */
  organizationId: string;
  /** Caller's project scope, or null when org-level. */
  projectId: string | null;
  /** SDP-managed custody wallet id whose signer authorizes the transfer. */
  sourceWalletId: string;
  /** Source wallet pubkey (== the resolved signer address). */
  from: Address;
  /** Destination channel wallet address. */
  to: Address;
  /** Token mint to transfer. */
  mint: Address;
  /** Decimal amount; converted to base units using the mint's decimals. */
  amount: string;
}

/** Build + custody-sign + submit + await an internal channel transfer. */
export async function executeChannelTransfer(
  env: Env,
  params: ExecuteChannelTransferParams
): Promise<PrivateChannelTransferResult> {
  const config = getPrivateChannelConfig(env);
  const rpc = createGatewayRpc(config);

  // Resolve the custody signer concurrently with the token-program + balance
  // reads — independent I/O (DB/KMS vs gateway RPC).
  const [{ tokenProgram, source }, authority] = await Promise.all([
    (async () => {
      const tokenProgram = await resolveTokenProgram(rpc, params.mint);
      const source = await getChannelBalance(rpc, {
        wallet: params.from,
        mint: params.mint,
        tokenProgram,
      });
      return { tokenProgram, source };
    })(),
    createOrgSigner(
      env,
      params.organizationId,
      params.projectId ?? undefined,
      params.sourceWalletId
    ),
  ]);

  if (!source.exists) {
    throw new PrivateChannelError(
      "BAD_REQUEST",
      "Source wallet has no channel balance for this mint."
    );
  }

  let amountBase: bigint;
  try {
    amountBase = parseDecimalAmount(params.amount, source.decimals);
  } catch (error) {
    throw new PrivateChannelError(
      "BAD_REQUEST",
      error instanceof Error ? error.message : "Invalid amount"
    );
  }
  if (amountBase <= 0n) {
    throw new PrivateChannelError("BAD_REQUEST", "Transfer amount must be greater than zero.");
  }

  if (authority.address !== params.from) {
    throw new PrivateChannelError(
      "BAD_REQUEST",
      "Resolved signing wallet does not match the source wallet."
    );
  }

  const receipt = await executeInternalTransfer({
    rpc,
    from: params.from,
    to: params.to,
    mint: params.mint,
    tokenProgram,
    amount: amountBase,
    decimals: source.decimals,
    authority,
  });

  return {
    signature: receipt.signature,
    slot: receipt.slot.toString(),
    confirmationStatus: receipt.confirmationStatus,
  };
}
