"use server";

import type { PrivateChannelUserDto } from "@sdp/types";
import { revalidatePath } from "next/cache";
import {
  addChannelMembership as addChannelMembershipCall,
  deletePrivateChannelUser as deletePrivateChannelUserCall,
  invitePrivateChannelUser as inviteCall,
  removeChannelMembership as removeChannelMembershipCall,
} from "@/lib/private-channels";
import { createSdpApiClient } from "@/lib/sdp-api";

const MEMBERS_PATH = "/dashboard/payments/private-channels/members";

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; message: string };

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error.";
  const match = /^SDP API request failed \(\d+\):\s*([\s\S]*)$/.exec(error.message);
  if (!match) return error.message;
  try {
    const parsed = JSON.parse(match[1] ?? "") as { error?: { message?: string } };
    return parsed.error?.message ?? error.message;
  } catch {
    return match[1] ?? error.message;
  }
}

export async function inviteMemberAction(
  userId: string
): Promise<ActionResult<{ user: PrivateChannelUserDto; inviteUrl: string }>> {
  try {
    const client = await createSdpApiClient();
    const value = await inviteCall(client, { userId });
    revalidatePath(MEMBERS_PATH);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function deleteMemberAction(id: string): Promise<ActionResult> {
  try {
    const client = await createSdpApiClient();
    await deletePrivateChannelUserCall(client, id);
    revalidatePath(MEMBERS_PATH);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function addToChannelAction(
  channelId: string,
  privateChannelUserId: string
): Promise<ActionResult> {
  try {
    const client = await createSdpApiClient();
    await addChannelMembershipCall(client, channelId, privateChannelUserId);
    revalidatePath(MEMBERS_PATH);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function removeFromChannelAction(
  channelId: string,
  privateChannelUserId: string
): Promise<ActionResult> {
  try {
    const client = await createSdpApiClient();
    await removeChannelMembershipCall(client, channelId, privateChannelUserId);
    revalidatePath(MEMBERS_PATH);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
