/**
 * Channel balance reads.
 *
 * The gateway does NOT implement `getTokenAccountsByOwner` (SPC-INTEGRATION.md
 * §4.2), so balances are read by deriving the ATA per `(wallet, mint)` and
 * calling `getTokenAccountBalance`. The caller supplies the mint set — the
 * package holds no instance/allowed-mint knowledge.
 *
 * Limitation: only the ATA is inspected; non-ATA token accounts are
 * undiscoverable through the gateway.
 *
 * Worker-safe: no Node built-ins, no DB.
 */

import { getAccountInfo, type SolanaRpc } from "@sdp/rpc/solana";
import { formatDecimalAmount } from "@sdp/solana/amount";
import { SPL_TOKEN_PROGRAMS } from "@sdp/types";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import { badRequest, gatewayUnavailable } from "./errors";
import type { SpcBalance } from "./types";

const SPL_TOKEN_PROGRAM_ID = SPL_TOKEN_PROGRAMS["spl-token"] as Address;
const SPL_TOKEN_2022_PROGRAM_ID = SPL_TOKEN_PROGRAMS["token-2022"] as Address;

/** One `(wallet, mint)` balance lookup. */
export interface BalanceRequest {
  /** Owner wallet whose channel balance is read. */
  wallet: Address;
  /** Token mint to read the balance for. */
  mint: Address;
  /** SPL program owning the mint; resolved from the mint account when omitted. */
  tokenProgram?: Address;
  /** Decimals to report when the ATA does not exist yet. */
  decimals?: number;
}

/** Resolve which SPL program owns a mint (classic SPL vs Token-2022). */
export async function resolveTokenProgram(rpc: SolanaRpc, mint: Address): Promise<Address> {
  const info = await getAccountInfo(rpc, mint);
  if (!info) {
    throw badRequest(`Mint account does not exist: ${mint}`);
  }
  if (info.owner === SPL_TOKEN_PROGRAM_ID || info.owner === SPL_TOKEN_2022_PROGRAM_ID) {
    return info.owner as Address;
  }
  throw badRequest(`Unsupported token program for mint ${mint}: ${info.owner}`);
}

/** Derive the associated token account for `(wallet, mint)` under `tokenProgram`. */
export async function deriveChannelAta(params: {
  wallet: Address;
  mint: Address;
  tokenProgram: Address;
}): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner: params.wallet,
    tokenProgram: params.tokenProgram,
    mint: params.mint,
  });
  return ata;
}

/**
 * Read one `(wallet, mint)` channel balance: resolve the token program, derive
 * the ATA, and read it — returning `amount: 0n, exists: false` when the ATA is
 * absent rather than throwing.
 */
export async function getChannelBalance(
  rpc: SolanaRpc,
  request: BalanceRequest
): Promise<SpcBalance> {
  const tokenProgram = request.tokenProgram ?? (await resolveTokenProgram(rpc, request.mint));
  const ata = await deriveChannelAta({ wallet: request.wallet, mint: request.mint, tokenProgram });

  // Check existence first: `getTokenAccountBalance` errors on a missing account,
  // and `getAccountInfo` is the cheaper, unambiguous existence probe.
  const info = await getAccountInfo(rpc, ata);
  if (!info) {
    const decimals = request.decimals ?? 0;
    return {
      wallet: request.wallet,
      mint: request.mint,
      tokenProgram,
      ata,
      amount: 0n,
      decimals,
      uiAmount: "0",
      exists: false,
    };
  }

  let value: { amount: string; decimals: number; uiAmountString?: string };
  try {
    const response = await rpc.getTokenAccountBalance(ata, { commitment: "confirmed" }).send();
    value = response.value;
  } catch (error) {
    throw gatewayUnavailable(`Failed to read token account balance for ${ata}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const amount = BigInt(value.amount);
  return {
    wallet: request.wallet,
    mint: request.mint,
    tokenProgram,
    ata,
    amount,
    decimals: value.decimals,
    uiAmount: value.uiAmountString ?? formatDecimalAmount(amount, value.decimals),
    exists: true,
  };
}

/** Batch balances for many `(wallet, mint)` pairs. */
export function getChannelBalances(
  rpc: SolanaRpc,
  requests: BalanceRequest[]
): Promise<SpcBalance[]> {
  return Promise.all(requests.map((request) => getChannelBalance(rpc, request)));
}
