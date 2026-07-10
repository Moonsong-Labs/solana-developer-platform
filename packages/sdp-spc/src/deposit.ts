/**
 * Deposit pathway (L1 → channel).
 *
 * Deposit is a permissionless escrow `Deposit` on devnet L1 signed by `payer` +
 * `user`, submitted to the devnet RPC (NOT the gateway). Settlement is tracked
 * via the indexer `transactions` row. Typed here; execution is not implemented
 * yet — it depends on the vendored escrow instruction builder.
 */

import type { SolanaRpc } from "@sdp/rpc/solana";
import type { TransactionSigner } from "@solana/kit";
import { methodNotSupported } from "./errors";
import type { DepositParams, PreparedTransaction, SpcTransferReceipt } from "./types";

/** Inputs to build an unsigned escrow `Deposit` transaction. */
export interface BuildDepositInput {
  /** L1 RPC client (devnet/mainnet), NOT the channel gateway. */
  l1Rpc: SolanaRpc;
  /** Deposit instruction parameters. */
  params: DepositParams;
}

/** Inputs to build, sign, submit, and confirm an escrow `Deposit`. */
export interface ExecuteDepositInput extends BuildDepositInput {
  /** Fee-payer signer. */
  payer: TransactionSigner;
  /** Depositing-user signer (the transfer authority). */
  user: TransactionSigner;
  /** Optional finality-wait timeout in ms. */
  timeoutMs?: number;
}

/** Build an unsigned escrow `Deposit` transaction. NOT IMPLEMENTED — throws. */
export async function buildDeposit(_input: BuildDepositInput): Promise<PreparedTransaction> {
  throw methodNotSupported("SPC deposit is not implemented yet.");
}

/** Build, sign, submit to L1, and await settlement. NOT IMPLEMENTED — throws. */
export async function executeDeposit(_input: ExecuteDepositInput): Promise<SpcTransferReceipt> {
  throw methodNotSupported("SPC deposit is not implemented yet.");
}
