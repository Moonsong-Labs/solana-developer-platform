/**
 * Private-channels domain service.
 *
 * Orchestrates `@sdp/spc` (Worker-safe transport) with SDP-owned concerns:
 * custody signer resolution (`createOrgSigner`) and instance config. Signing is
 * server-side custody; the library stays signer-agnostic.
 *
 * Node/DB-adjacent pathways (reconciliation via the indexer replica, allowed-mint
 * mirroring) are app-owned and live here — never in the package.
 */

import { parseDecimalAmount } from "@sdp/solana/amount";
import {
  createGatewayRpc,
  executeInternalTransfer,
  gatewayHealth,
  gatewayReady,
  getChannelBalance,
  getChannelBalances,
  resolveTokenProgram,
  type SpcBalance,
  SpcError,
} from "@sdp/spc";
import type {
  PrivateChannelBalance,
  PrivateChannelInstanceInfo,
  PrivateChannelTransferResult,
} from "@sdp/types";
import type { Address } from "@solana/kit";
import { createOrgSigner } from "@/services/solana";
import type { Env } from "@/types/env";
import { getSpcConfig } from "./config";

/** Map an engine `SpcBalance` (bigint) to the JSON-safe wire DTO (strings). */
function toBalanceDto(balance: SpcBalance): PrivateChannelBalance {
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
  const config = getSpcConfig(env);
  const [health, ready] = await Promise.all([
    gatewayHealth(config).catch(() => ({ ok: false, status: 0 })),
    gatewayReady(config).catch(() => ({ ok: false, status: 0 })),
  ]);

  return {
    gatewayUrl: config.gatewayUrl,
    authMode: config.authMode,
    network: config.network,
    healthy: health.ok,
    ready: ready.ok,
    ...(config.escrowProgramId ? { escrowProgramId: config.escrowProgramId } : {}),
    ...(config.withdrawProgramId ? { withdrawProgramId: config.withdrawProgramId } : {}),
    ...(config.escrowInstance ? { escrowInstance: config.escrowInstance } : {}),
    ...(config.usdcMint ? { usdcMint: config.usdcMint } : {}),
  };
}

/** Read channel balances for a wallet across a caller-supplied mint set. */
export async function getWalletChannelBalances(
  env: Env,
  params: { wallet: Address; mints: Address[] }
): Promise<PrivateChannelBalance[]> {
  const config = getSpcConfig(env);
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
  const config = getSpcConfig(env);
  const rpc = createGatewayRpc(config);

  const tokenProgram = await resolveTokenProgram(rpc, params.mint);
  const source = await getChannelBalance(rpc, {
    wallet: params.from,
    mint: params.mint,
    tokenProgram,
  });
  if (!source.exists) {
    throw new SpcError("BAD_REQUEST", "Source wallet has no channel balance for this mint.");
  }

  let amountBase: bigint;
  try {
    amountBase = parseDecimalAmount(params.amount, source.decimals);
  } catch (error) {
    throw new SpcError("BAD_REQUEST", error instanceof Error ? error.message : "Invalid amount");
  }
  if (amountBase <= 0n) {
    throw new SpcError("BAD_REQUEST", "Transfer amount must be greater than zero.");
  }

  const authority = await createOrgSigner(
    env,
    params.organizationId,
    params.projectId ?? undefined,
    params.sourceWalletId
  );
  if (authority.address !== params.from) {
    throw new SpcError("BAD_REQUEST", "Resolved signing wallet does not match the source wallet.");
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
