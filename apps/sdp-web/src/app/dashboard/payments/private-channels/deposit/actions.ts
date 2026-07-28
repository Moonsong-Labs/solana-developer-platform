"use server";

import type { PrivateChannelDeposit } from "@sdp/types";
import { revalidatePath } from "next/cache";
import {
  createPrivateChannelDeposit,
  fetchPrivateChannelBalance,
  fetchPrivateChannelDeposit,
  fetchSignableWalletsWithBalances,
} from "@/lib/private-channels";
import { createSdpApiClient, extractSdpApiErrorMessage } from "@/lib/sdp-api";

export interface CreateDepositInput {
  walletId: string;
  amount: string;
  recipient?: string;
}

export type CreateDepositResult =
  | { ok: true; deposit: PrivateChannelDeposit }
  | { ok: false; kind: "validation"; message: string }
  | { ok: false; kind: "server"; message: string };

export async function createDepositAction(input: CreateDepositInput): Promise<CreateDepositResult> {
  if (!input.walletId) {
    return { ok: false, kind: "validation", message: "Select a wallet to deposit from." };
  }
  const amount = Number(input.amount);
  if (!input.amount || Number.isNaN(amount) || amount <= 0) {
    return { ok: false, kind: "validation", message: "Enter an amount greater than zero." };
  }

  try {
    const client = await createSdpApiClient();
    const deposit = await createPrivateChannelDeposit(client, {
      walletId: input.walletId,
      amount: input.amount,
      ...(input.recipient ? { recipient: input.recipient } : {}),
    });
    revalidatePath("/dashboard/payments/private-channels/deposit");
    return { ok: true, deposit };
  } catch (error) {
    return { ok: false, kind: "server", message: extractSdpApiErrorMessage(error) };
  }
}

/** Poll target for the progress view. Returns null on transient failures. */
export async function fetchDepositAction(id: string): Promise<PrivateChannelDeposit | null> {
  try {
    const client = await createSdpApiClient();
    return await fetchPrivateChannelDeposit(client, id);
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
 * given wallet, in parallel. Individual failures degrade to `null` rather than
 * throwing — the UI treats missing balances as "not available" rather than an
 * error state.
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
