/**
 * Private Channels deposit flow.
 *
 * Moves USDC from a custody wallet into the instance escrow on the instance's
 * chain (devnet), then the operator credits it into the channel (detected later
 * via the gateway balance). The tx is server-signed by the custody wallet, which
 * is BOTH the escrow `user` (moves the tokens) and the escrow `payer` / tx fee
 * payer (pays rent + the SOL fee). Broadcast targets `instance.chainRpcUrl`, NOT
 * the default RPC or the gateway.
 *
 * TODO(gasless): revert to the Kora/native sponsored fee-payer model (the
 * `payer` = `createNoopSigner(feePayment.getFeePayer())`, tx fee payer set via
 * `setTransactionMessageFeePayer`, sign with `partiallySignTransactionMessageWithSigners`
 * then `feePayment.signAsFeePayer`) once the escrow program `9tgHa1…` is added to
 * Kora's allowed-program list. Today the hosted Kora relay rejects the deposit
 * ("Program 9tgHa1… is not in the allowed list") because it only sponsors
 * transactions that touch allow-listed programs, so the depositor pays their own
 * fee for now. See `createFeePaymentAdapter` in `@/services/adapters/fee-payment`.
 *
 * Lifecycle here: prepared (persist) → submitted (broadcast) → confirmed (on
 * devnet). `credited` is detected asynchronously by the reconciler / the page
 * poll via `getChannelBalance`.
 */

import * as solanaRpc from "@sdp/rpc/solana";
import { parseDecimalAmount } from "@sdp/solana/amount";
import {
  getDepositInstructionAsync,
  PRIVATE_CHANNEL_ESCROW_PROGRAM_ADDRESS,
} from "@sdp/spc-escrow";
import type { PrivateChannelDeposit, PrivateChannelInstance } from "@sdp/types";
import {
  type Address,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  type Signature,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { signTransactionMessageWithSigners } from "@solana/signers";
import {
  createPrivateChannelDepositRepository,
  mapPrivateChannelDepositRow,
  type PrivateChannelDepositRow,
} from "@/db/repositories";
import { AppError, badRequest } from "@/lib/errors";
import * as solanaServices from "@/services/solana";
import type { CustodyWallet } from "@/services/stores/custody-config.store";
import type { Env } from "@/types/env";
import type { GatewayAuthHandle } from "./auth/gateway-auth";
import { getChannelBalance } from "./balance";
import { confirmAndPersistDeposit } from "./deposit-confirm";
import { emitDepositEvent } from "./deposit-events";
import { defaultChannelMint, inferCluster, knownMintDecimals } from "./mint";

/** The instance fields the deposit needs. */
type DepositInstance = Pick<
  PrivateChannelInstance,
  "id" | "gatewayUrl" | "chainRpcUrl" | "escrowProgramId" | "escrowInstanceAddr"
>;

export interface CreateChannelDepositInput {
  instance: DepositInstance;
  organizationId: string;
  projectId: string;
  /** Custody wallet the deposit is signed from (the escrow `user`). */
  wallet: CustodyWallet;
  /** UI decimal amount (e.g. "1.5"). */
  amount: string;
  /** Address credited in the channel; defaults to the depositor. */
  recipient?: string;
  /**
   * SPC gateway auth handle for the baseline read. Required when the connected
   * instance has auth enabled (the gateway JWT-gates balance reads); resolved by
   * the handler via `resolveGatewayAuth`.
   */
  gatewayAuth?: GatewayAuthHandle;
}

/**
 * Build, sign, broadcast, and confirm a deposit on the instance chain. Returns
 * the built transaction signature.
 */
async function broadcastDeposit(
  env: Env,
  input: {
    instance: DepositInstance;
    organizationId: string;
    projectId: string;
    wallet: CustodyWallet;
    mint: Address;
    recipient: Address;
    amountBaseUnits: bigint;
  }
): Promise<Signature> {
  const signer = await solanaServices.createOrgSigner(
    env,
    input.organizationId,
    input.projectId,
    input.wallet.walletId
  );
  if (signer.address !== input.wallet.publicKey) {
    throw badRequest("Resolved signing wallet does not match the deposit wallet");
  }

  // TODO(gasless): `payer` should be the sponsored fee payer once the escrow
  // program is allow-listed on Kora — for now the custody wallet pays (see the
  // module-level note). payer === user, so the wallet signs once for both.
  const depositIx = await getDepositInstructionAsync({
    payer: signer,
    user: signer,
    instance: address(input.instance.escrowInstanceAddr),
    mint: input.mint,
    amount: input.amountBaseUnits,
    recipient: input.recipient,
  });

  // Blockhash + broadcast + confirm all target the instance chain (devnet).
  const chainRpc = solanaRpc.createRpc(env, { rpcUrl: input.instance.chainRpcUrl });
  const { blockhash, lastValidBlockHeight } = await solanaRpc.getRecentBlockhash(
    chainRpc,
    "confirmed"
  );

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions([depositIx], m)
  );

  // The custody wallet is the only signer (payer + user); fully sign and broadcast.
  const signed = await signTransactionMessageWithSigners(message);
  const signedBytes = new Uint8Array(getTransactionEncoder().encode(signed));
  return solanaRpc.sendTransaction(chainRpc, signedBytes);
}

/** Create a deposit intent: persist, broadcast to devnet, confirm on-chain. */
export async function createChannelDeposit(
  env: Env,
  input: CreateChannelDepositInput
): Promise<PrivateChannelDeposit> {
  const { instance, organizationId, projectId, wallet } = input;

  // The generated escrow client is pinned to one program; fail loud if a future
  // instance points at a different deployment (the derived PDAs would be wrong).
  if (instance.escrowProgramId !== PRIVATE_CHANNEL_ESCROW_PROGRAM_ADDRESS) {
    throw badRequest(
      `This instance's escrow program (${instance.escrowProgramId}) is not supported; ` +
        `the deposit client targets ${PRIVATE_CHANNEL_ESCROW_PROGRAM_ADDRESS}.`
    );
  }

  const cluster = inferCluster(instance.chainRpcUrl);
  const mint = defaultChannelMint(cluster);
  const decimals = knownMintDecimals(mint, cluster) ?? 6;
  const depositor = wallet.publicKey;
  const recipient = input.recipient ?? depositor;

  const amountBaseUnits = parseDecimalAmount(input.amount, decimals);
  if (amountBaseUnits <= 0n) {
    throw badRequest("amount must be greater than zero");
  }

  // Capture the recipient's current channel balance so the reconciler can detect
  // the credit delta once the operator credits the deposit.
  const baseline = await getChannelBalance(env, {
    instance,
    owner: recipient,
    mint,
    auth: input.gatewayAuth,
  });

  const repo = createPrivateChannelDepositRepository(env);
  const created = await repo.createDeposit({
    organizationId,
    projectId,
    instanceId: instance.id,
    walletId: wallet.walletId,
    depositor,
    recipient,
    mint,
    amount: input.amount,
    baselineCredited: baseline.amount,
    // Snapshot the reconciliation context so a later reconnect can't move it.
    gatewayUrl: instance.gatewayUrl,
    chainRpcUrl: instance.chainRpcUrl,
    escrowProgramId: instance.escrowProgramId,
    escrowInstanceAddr: instance.escrowInstanceAddr,
  });
  if (!created) {
    throw new AppError("INTERNAL_ERROR", "Failed to persist the deposit intent.");
  }

  let latest: PrivateChannelDepositRow = created;

  // Broadcast. A failure here means the transaction never reached the chain (no
  // signature), so the deposit is a terminal failure — no funds moved.
  let signature: Signature;
  try {
    signature = await broadcastDeposit(env, {
      instance,
      organizationId,
      projectId,
      wallet,
      mint: address(mint),
      recipient: address(recipient),
      amountBaseUnits,
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Deposit submission failed.";
    const failed = await repo.updateDeposit({ id: created.id, status: "failed", failureReason });
    return mapPrivateChannelDepositRow(failed ?? created);
  }

  latest =
    (await repo.updateDeposit({
      id: created.id,
      status: "submitted",
      signature,
      expectedStatus: "prepared",
    })) ?? latest;

  // Best-effort activity event (never bubbles): deposit broadcast.
  await emitDepositEvent(env, latest, "transfer.deposit.submitted", "pending", { signature });

  // Confirm on the instance chain and persist the outcome. A transport/timeout
  // error here leaves the deposit `submitted` (the reconciler finalizes it); only
  // a real on-chain error marks it `failed`. See `confirmAndPersistDeposit`.
  const settled = await confirmAndPersistDeposit(env, repo, {
    depositId: created.id,
    chainRpcUrl: instance.chainRpcUrl,
    signature,
  });
  if (settled) {
    latest = settled;
  }

  return mapPrivateChannelDepositRow(latest);
}

/** Read a single deposit for the project. */
export async function getChannelDeposit(
  env: Env,
  scope: { organizationId: string; projectId: string; id: string }
): Promise<PrivateChannelDeposit | null> {
  const row = await createPrivateChannelDepositRepository(env).getDepositById(scope);
  return row ? mapPrivateChannelDepositRow(row) : null;
}

/** List a project's deposits, newest first. */
export async function listChannelDeposits(
  env: Env,
  scope: { organizationId: string; projectId: string }
): Promise<PrivateChannelDeposit[]> {
  const rows = await createPrivateChannelDepositRepository(env).listDepositsByProject(scope);
  return rows.map(mapPrivateChannelDepositRow);
}
