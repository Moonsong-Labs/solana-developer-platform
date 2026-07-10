/**
 * Withdraw pathway (channel → L1).
 *
 * Withdraw is a user-signed `WithdrawFunds` burn submitted to the gateway; the
 * indexer picks up the event and the operator releases on L1. Typed here;
 * execution is not implemented yet — it depends on the vendored withdraw
 * instruction builder.
 */

import type { SolanaRpc } from "@sdp/rpc/solana";
import type { TransactionSigner } from "@solana/kit";
import { methodNotSupported } from "./errors";
import type { PreparedTransaction, SpcTransferReceipt, WithdrawParams } from "./types";

/** Inputs to build an unsigned `WithdrawFunds` burn transaction. */
export interface BuildWithdrawInput {
  /** Gateway RPC client (the burn is submitted to the channel). */
  rpc: SolanaRpc;
  /** Withdraw instruction parameters. */
  params: WithdrawParams;
}

/** Inputs to build, sign, submit, and confirm a `WithdrawFunds` burn. */
export interface ExecuteWithdrawInput extends BuildWithdrawInput {
  /** Withdrawing-user signer (the burn authority). */
  user: TransactionSigner;
  /** Optional finality-wait timeout in ms. */
  timeoutMs?: number;
}

/** Build an unsigned `WithdrawFunds` burn transaction. NOT IMPLEMENTED — throws. */
export async function buildWithdraw(_input: BuildWithdrawInput): Promise<PreparedTransaction> {
  throw methodNotSupported("SPC withdraw is not implemented yet.");
}

/** Build, sign, submit to the gateway, and await the burn. NOT IMPLEMENTED — throws. */
export async function executeWithdraw(_input: ExecuteWithdrawInput): Promise<SpcTransferReceipt> {
  throw methodNotSupported("SPC withdraw is not implemented yet.");
}
