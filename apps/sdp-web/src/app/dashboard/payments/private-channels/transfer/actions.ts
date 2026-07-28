"use server";

import type { PrivateChannelTransfer, PrivateChannelTransferRecipientDto } from "@sdp/types";
import { revalidatePath } from "next/cache";
import {
  createPrivateChannelTransfer,
  fetchPrivateChannelTransferRecipients,
} from "@/lib/private-channels";
import { createSdpApiClient, extractSdpApiErrorMessage } from "@/lib/sdp-api";
import { getTransferAmountError } from "./transfer-validation";

export interface CreateTransferInput {
  channelId: string;
  walletId: string;
  recipientVerifiedWalletId: string;
  amount: string;
}

export type CreateTransferResult =
  | { ok: true; transfer: PrivateChannelTransfer }
  | { ok: false; kind: "validation"; message: string }
  | { ok: false; kind: "server"; message: string };

export type FetchTransferRecipientsResult =
  | { ok: true; recipients: PrivateChannelTransferRecipientDto[] }
  | { ok: false; message: string };

export async function createTransferAction(
  input: CreateTransferInput
): Promise<CreateTransferResult> {
  if (!input.channelId) {
    return { ok: false, kind: "validation", message: "Select a channel." };
  }
  if (!input.walletId) {
    return { ok: false, kind: "validation", message: "Select a verified source wallet." };
  }
  if (!input.recipientVerifiedWalletId) {
    return { ok: false, kind: "validation", message: "Select a verified recipient wallet." };
  }
  const amountError = getTransferAmountError(input.amount);
  if (amountError) {
    return { ok: false, kind: "validation", message: amountError };
  }
  try {
    const client = await createSdpApiClient();
    const transfer = await createPrivateChannelTransfer(
      client,
      input.channelId,
      {
        walletId: input.walletId,
        recipientVerifiedWalletId: input.recipientVerifiedWalletId,
        amount: input.amount.trim(),
      }
    );
    revalidatePath("/dashboard/payments/private-channels/transfer");
    return { ok: true, transfer };
  } catch (error) {
    return { ok: false, kind: "server", message: extractSdpApiErrorMessage(error) };
  }
}

export async function fetchTransferRecipientsAction(
  channelId: string
): Promise<FetchTransferRecipientsResult> {
  if (!channelId) {
    return { ok: false, message: "Select a channel to load verified recipients." };
  }
  try {
    const client = await createSdpApiClient();
    const recipients = await fetchPrivateChannelTransferRecipients(client, channelId);
    return { ok: true, recipients };
  } catch (error) {
    return { ok: false, message: extractSdpApiErrorMessage(error) };
  }
}

