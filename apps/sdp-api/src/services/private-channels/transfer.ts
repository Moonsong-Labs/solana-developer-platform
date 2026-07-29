import * as solanaRpc from "@sdp/rpc/solana";
import { AmountError, parseDecimalAmount } from "@sdp/solana/amount";
import type {
  PrivateChannelInstance,
  PrivateChannelTransfer,
  PrivateChannelMemberTransferStatus,
} from "@sdp/types";
import { PRIVATE_CHANNEL_EVENT_STATUSES, PRIVATE_CHANNEL_EVENT_TYPES } from "@sdp/types";
import {
  type Address,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getSignatureFromTransaction,
  getTransactionEncoder,
  pipe,
  type Signature,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type TransactionSigner,
} from "@solana/kit";
import { signTransactionMessageWithSigners } from "@solana/signers";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  createPrivateChannelTransferRepository,
  generatePrivateChannelTransferId,
  mapPrivateChannelTransferRow,
  type PrivateChannelTransferRepository,
  type PrivateChannelTransferRow,
} from "@/db/repositories";
import { AppError, badRequest } from "@/lib/errors";
import * as solanaServices from "@/services/solana";
import type { CustodyWallet } from "@/services/stores/custody-config.store";
import type { Env } from "@/types/env";
import { type SpcAuthContext, withGatewayRpc } from "./auth/gateway-auth";
import { getChannelBalance } from "./balance";
import { defaultChannelMint, inferCluster, knownMintDecimals } from "./mint";
import { emitTransferEvent } from "./transfer-events";

type TransferInstance = Pick<PrivateChannelInstance, "id" | "gatewayUrl" | "chainRpcUrl">;

export interface CreateChannelTransferInput {
  instance: TransferInstance;
  organizationId: string;
  projectId: string;
  channelId: string;
  /** The already-resolved SDP custody wallet selected by the acting user. */
  wallet: CustodyWallet;
  /** The already-resolved verified wallet of another channel member. */
  recipient: {
    privateChannelUserId: string;
    verifiedWalletId: string;
    pubkey: string;
  };
  amount: string;
  gatewayAuth: SpcAuthContext;
}

export async function buildClassicTransferInstructions(input: {
  signer: TransactionSigner;
  mint: Address;
  recipient: Address;
  amountBaseUnits: bigint;
}) {
  const [sourceTokenAccount] = await findAssociatedTokenPda({
    owner: input.signer.address,
    mint: input.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [destinationTokenAccount] = await findAssociatedTokenPda({
    owner: input.recipient,
    mint: input.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  return {
    sourceTokenAccount,
    destinationTokenAccount,
    instructions: [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: input.signer,
        ata: destinationTokenAccount,
        owner: input.recipient,
        mint: input.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
      getTransferInstruction({
        source: sourceTokenAccount,
        destination: destinationTokenAccount,
        authority: input.signer,
        amount: input.amountBaseUnits,
      }),
    ] as const,
  };
}

async function prepareTransferTransaction(
  env: Env,
  input: {
    instance: TransferInstance;
    organizationId: string;
    projectId: string;
    wallet: CustodyWallet;
    mint: Address;
    recipient: Address;
    amountBaseUnits: bigint;
    gatewayAuth: SpcAuthContext;
  }
): Promise<{ signature: Signature; signedBytes: Uint8Array }> {
  const signer = await solanaServices.createOrgSigner(
    env,
    input.organizationId,
    input.projectId,
    input.wallet.walletId
  );
  if (signer.address !== input.wallet.publicKey) {
    throw badRequest("Resolved signing wallet does not match the transfer wallet");
  }

  const { instructions } = await buildClassicTransferInstructions({
    signer,
    mint: input.mint,
    recipient: input.recipient,
    amountBaseUnits: input.amountBaseUnits,
  });
  const { blockhash, lastValidBlockHeight } = await withGatewayRpc(
    env,
    input.instance.gatewayUrl,
    input.gatewayAuth,
    (gatewayRpc) => solanaRpc.getRecentBlockhash(gatewayRpc, "confirmed")
  );
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );
  const signed = await signTransactionMessageWithSigners(message);
  return {
    signature: getSignatureFromTransaction(signed),
    signedBytes: new Uint8Array(getTransactionEncoder().encode(signed)),
  };
}

type PersistTransferInput = CreateChannelTransferInput & {
  sender: Address;
  recipientAddress: Address;
  mint: Address;
  status: PrivateChannelMemberTransferStatus;
  signature: Signature | null;
  failureReason: string | null;
};

/** Build a client-visible terminal row when the audit insert cannot be stored. */
function ephemeralTransferRow(input: PersistTransferInput): PrivateChannelTransferRow {
  const now = new Date().toISOString();
  return {
    id: generatePrivateChannelTransferId(),
    organization_id: input.organizationId,
    project_id: input.projectId,
    instance_id: input.instance.id,
    channel_id: input.channelId,
    sender_private_channel_user_id: input.gatewayAuth.pcUserId,
    recipient_private_channel_user_id: input.recipient.privateChannelUserId,
    sender_wallet_id: input.wallet.walletId,
    recipient_verified_wallet_id: input.recipient.verifiedWalletId,
    sender: input.sender,
    recipient: input.recipientAddress,
    mint: input.mint,
    amount: input.amount,
    status: input.status,
    signature: input.signature,
    failure_reason: input.failureReason,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Persist the terminal result. On insert failure, still return a DTO-shaped row so
 * callers can surface the SPC outcome (especially a post-accept signature) instead of
 * a bare 500 that invites an unsafe blind retry.
 */
async function persistTransfer(
  repo: PrivateChannelTransferRepository,
  input: PersistTransferInput
): Promise<PrivateChannelTransferRow> {
  try {
    const row = await repo.createTransfer({
      organizationId: input.organizationId,
      projectId: input.projectId,
      instanceId: input.instance.id,
      channelId: input.channelId,
      senderPrivateChannelUserId: input.gatewayAuth.pcUserId,
      recipientPrivateChannelUserId: input.recipient.privateChannelUserId,
      senderWalletId: input.wallet.walletId,
      recipientVerifiedWalletId: input.recipient.verifiedWalletId,
      sender: input.sender,
      recipient: input.recipientAddress,
      mint: input.mint,
      amount: input.amount,
      status: input.status,
      signature: input.signature,
      failureReason: input.failureReason,
    });
    if (row) {
      return row;
    }
  } catch (error) {
    console.error("private-channel-transfer persist failed", {
      status: input.status,
      signature: input.signature,
      channelId: input.channelId,
      error: error instanceof Error ? error.message : error,
    });
  }

  console.error("private-channel-transfer returning unpersisted terminal result", {
    status: input.status,
    signature: input.signature,
    channelId: input.channelId,
  });
  return ephemeralTransferRow(input);
}

/**
 * Send once through SPC, then persist the terminal response.
 *
 * An SPC success is recorded as confirmed. Any build or SPC error is recorded as
 * failed and may be retried by the user; no status polling or automatic retry occurs.
 */
export async function createChannelTransfer(
  env: Env,
  input: CreateChannelTransferInput
): Promise<PrivateChannelTransfer> {
  const cluster = inferCluster(input.instance.chainRpcUrl);
  const mint = address(defaultChannelMint(cluster));
  const decimals = knownMintDecimals(mint, cluster) ?? 6;
  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = parseDecimalAmount(input.amount, decimals);
  } catch (error) {
    if (error instanceof AmountError) {
      throw badRequest(error.message);
    }
    throw error;
  }
  if (amountBaseUnits <= 0n) {
    throw badRequest("amount must be greater than zero");
  }

  const sender = address(input.wallet.publicKey);
  const recipientAddress = address(input.recipient.pubkey);
  const balance = await getChannelBalance(env, {
    instance: input.instance,
    owner: sender,
    mint,
    auth: input.gatewayAuth,
  });
  if (amountBaseUnits > BigInt(balance.amount)) {
    throw new AppError("INSUFFICIENT_TOKEN_BALANCE");
  }

  const repo = createPrivateChannelTransferRepository(env);
  let prepared: { signature: Signature; signedBytes: Uint8Array };
  try {
    prepared = await prepareTransferTransaction(env, {
      instance: input.instance,
      organizationId: input.organizationId,
      projectId: input.projectId,
      wallet: input.wallet,
      mint,
      recipient: recipientAddress,
      amountBaseUnits,
      gatewayAuth: input.gatewayAuth,
    });
  } catch (error) {
    const failed = await persistTransfer(repo, {
      ...input,
      sender,
      recipientAddress,
      mint,
      status: "failed",
      signature: null,
      failureReason: error instanceof Error ? error.message : "Transfer preparation failed.",
    });
    return mapPrivateChannelTransferRow(failed);
  }

  let gatewaySignature: Signature;
  try {
    gatewaySignature = await withGatewayRpc(
      env,
      input.instance.gatewayUrl,
      input.gatewayAuth,
      (gatewayRpc) => solanaRpc.sendTransaction(gatewayRpc, prepared.signedBytes)
    );
  } catch (error) {
    const failed = await persistTransfer(repo, {
      ...input,
      sender,
      recipientAddress,
      mint,
      status: "failed",
      signature: prepared.signature,
      failureReason: error instanceof Error ? error.message : "SPC transfer failed.",
    });
    return mapPrivateChannelTransferRow(failed);
  }

  const confirmed = await persistTransfer(repo, {
    ...input,
    sender,
    recipientAddress,
    mint,
    status: "confirmed",
    signature: gatewaySignature,
    failureReason: null,
  });
  await emitTransferEvent(
    env,
    confirmed,
    PRIVATE_CHANNEL_EVENT_TYPES.TRANSFER_TRANSFER_CONFIRMED,
    PRIVATE_CHANNEL_EVENT_STATUSES.CONFIRMED
  );
  return mapPrivateChannelTransferRow(confirmed);
}
