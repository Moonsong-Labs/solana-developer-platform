"use server";

import type { PrivateChannelWithdrawal } from "@sdp/types";
import { revalidatePath } from "next/cache";
import {
  createPrivateChannelWithdrawal,
  fetchPrivateChannelBalance,
  fetchPrivateChannelWithdrawal,
  fetchSignableWalletsWithBalances,
} from "@/lib/private-channels";
import { createSdpApiClient, extractSdpApiErrorMessage } from "@/lib/sdp-api";

export interface CreateWithdrawalInput {
  walletId: string;
  amount: string;
  destination?: string;
}

export type CreateWithdrawalResult =
  | { ok: true; withdrawal: PrivateChannelWithdrawal }
  | { ok: false; kind: "validation"; message: string }
  | { ok: false; kind: "server"; message: string };

export async function createWithdrawalAction(
  input: CreateWithdrawalInput
): Promise<CreateWithdrawalResult> {
  if (!input.walletId) {
    return { ok: false, kind: "validation", message: "Select a wallet to withdraw from." };
  }
  const amount = Number(input.amount);
  if (!input.amount || Number.isNaN(amount) || amount <= 0) {
    return { ok: false, kind: "validation", message: "Enter an amount greater than zero." };
  }

  try {
    const client = await createSdpApiClient();
    const withdrawal = await createPrivateChannelWithdrawal(client, {
      walletId: input.walletId,
      amount: input.amount,
      ...(input.destination ? { destination: input.destination } : {}),
    });
    revalidatePath("/dashboard/payments/private-channels/withdraw");
    return { ok: true, withdrawal };
  } catch (error) {
    return { ok: false, kind: "server", message: extractSdpApiErrorMessage(error) };
  }
}

/** Poll target for the progress view. Returns null on transient failures. */
export async function fetchWithdrawalAction(id: string): Promise<PrivateChannelWithdrawal | null> {
  try {
    const client = await createSdpApiClient();
    return await fetchPrivateChannelWithdrawal(client, id);
  } catch {
    return null;
  }
}

export interface WalletBalanceView {
  /** Channel-side USDC balance (SPC gateway). Null when the read failed. */
  channel: string | null;
  /** On-chain USDC balance in the wallet's devnet ATA. Null when the read failed. */
  onChain: string | null;
}

/**
 * Read both the channel USDC balance and the wallet's on-chain USDC for the
 * given wallet, in parallel. Individual failures degrade to `null`.
 */
export async function fetchWalletBalancesAction(walletId: string): Promise<WalletBalanceView> {
  if (!walletId) return { channel: null, onChain: null };
  const client = await createSdpApiClient();
  const [channelResult, walletsResult] = await Promise.allSettled([
    fetchPrivateChannelBalance(client, walletId),
    fetchSignableWalletsWithBalances(client),
  ]);
  const channel = channelResult.status === "fulfilled" ? channelResult.value : null;
  const wallets = walletsResult.status === "fulfilled" ? walletsResult.value : [];
  const wallet = wallets.find((w) => w.walletId === walletId);
  const onChainToken =
    channel && wallet?.balances ? wallet.balances.find((b) => b.mint === channel.mint) : null;
  return {
    channel: channel?.uiAmount ?? null,
    onChain: onChainToken?.uiAmount ?? (wallet ? "0" : null),
  };
}
