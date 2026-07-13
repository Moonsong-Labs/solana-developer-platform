/**
 * Internal channel transfer (SPL `TransferChecked` on the channel SVM).
 *
 * Signer-agnostic by design: `executeInternalTransfer` takes an injected
 * `@solana/kit` `TransactionSigner` (the sdp-api service resolves it from
 * custody; a browser wallet could supply one later).
 *
 * The channel is gasless, so the fee payer is the transfer authority. Both the
 * source and destination ATAs must already exist on the channel.
 */

import { getRecentBlockhash, type Signature, type SolanaRpc } from "@sdp/rpc/solana";
import {
  type Address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token";
import { deriveChannelAta } from "./balances";
import { badRequest } from "./errors";
import { awaitFinalized, submitToGateway } from "./gateway";
import type { PrivateChannelTransferReceipt } from "./types";

/** Fields shared by the internal transfer inputs. */
interface TransferBase {
  rpc: SolanaRpc;
  /** Source wallet owner (holds the channel balance). */
  from: Address;
  /** Destination wallet owner. */
  to: Address;
  mint: Address;
  /** SPL program that owns the mint (classic SPL or Token-2022). */
  tokenProgram: Address;
  /** Amount in base units. */
  amount: bigint;
  decimals: number;
}

/** Inputs to build, sign, submit, and confirm an internal transfer. */
export interface ExecuteInternalTransferInput extends TransferBase {
  /** The transfer authority signer (its address must equal `from`). */
  authority: TransactionSigner;
  /** Optional finality-wait timeout in ms. */
  timeoutMs?: number;
}

/** Derive the source and destination ATAs for a transfer, in parallel. */
async function resolveAtas(input: TransferBase): Promise<{ fromAta: Address; toAta: Address }> {
  const [fromAta, toAta] = await Promise.all([
    deriveChannelAta({ wallet: input.from, mint: input.mint, tokenProgram: input.tokenProgram }),
    deriveChannelAta({ wallet: input.to, mint: input.mint, tokenProgram: input.tokenProgram }),
  ]);
  return { fromAta, toAta };
}

/**
 * Build, sign (with the injected authority), submit to the gateway, and await
 * finality. Rejects if the signer does not control the source wallet.
 */
export async function executeInternalTransfer(
  input: ExecuteInternalTransferInput
): Promise<PrivateChannelTransferReceipt> {
  if (input.authority.address !== input.from) {
    throw badRequest("Transfer authority signer does not control the source wallet.", {
      authority: input.authority.address,
      from: input.from,
    });
  }

  const { fromAta, toAta } = await resolveAtas(input);
  const { blockhash, lastValidBlockHeight } = await getRecentBlockhash(input.rpc, "confirmed");

  const instruction = getTransferCheckedInstruction(
    {
      source: fromAta,
      mint: input.mint,
      destination: toAta,
      authority: input.authority,
      amount: input.amount,
      decimals: input.decimals,
    },
    { programAddress: input.tokenProgram }
  );

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(input.authority, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions([instruction], m)
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const bytes = new Uint8Array(getTransactionEncoder().encode(signedTx));
  const signature: Signature = await submitToGateway(input.rpc, bytes);

  return awaitFinalized(input.rpc, signature, {
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });
}
