"use server";

import type { PrivateChannelDeposit } from "@sdp/types";
import { revalidatePath } from "next/cache";
import { createPrivateChannelDeposit, fetchPrivateChannelDeposit } from "@/lib/private-channels";
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
