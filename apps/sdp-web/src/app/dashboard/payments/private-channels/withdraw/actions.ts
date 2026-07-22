"use server";

import type { PrivateChannelWithdrawal } from "@sdp/types";
import { revalidatePath } from "next/cache";
import {
  createPrivateChannelWithdrawal,
  fetchPrivateChannelWithdrawal,
} from "@/lib/private-channels";
import { createSdpApiClient } from "@/lib/sdp-api";

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
    return { ok: false, kind: "server", message: extractApiMessage(error) };
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

function extractApiMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error.";
  }
  const match = /^SDP API request failed \(\d+\):\s*([\s\S]*)$/.exec(error.message);
  if (!match) {
    return error.message;
  }
  try {
    const payload = JSON.parse(match[1] ?? "") as { error?: { message?: string } };
    return payload.error?.message ?? error.message;
  } catch {
    return error.message;
  }
}
