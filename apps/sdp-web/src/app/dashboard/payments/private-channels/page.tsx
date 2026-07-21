import type { PrivateChannelInstanceEnvelope } from "@sdp/types";
import { redirect } from "next/navigation";
import { createSdpApiClient } from "@/lib/sdp-api";

// Overview is the landing when connected; Instance is the landing otherwise.
// A dedicated overview page (cards / summaries) can replace the redirect once
// there's enough section-level content to justify it.
export default async function PrivateChannelsPage() {
  let target = "/dashboard/payments/private-channels/instance";
  try {
    const client = await createSdpApiClient();
    const res = await client.fetch<PrivateChannelInstanceEnvelope>("/v1/private-channels/instance");
    if (res.instance?.isActive) {
      target = "/dashboard/payments/private-channels/overview";
    }
  } catch {
    // fall through — /instance is a safe default (renders 404 if flag is off)
  }
  redirect(target);
}
