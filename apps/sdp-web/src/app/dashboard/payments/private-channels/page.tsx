import type { PrivateChannelInstanceEnvelope } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { privateChannels } from "@/flags";
import { createSdpApiClient } from "@/lib/sdp-api";

// Overview is the landing when connected; Instance is the landing otherwise.
export default async function PrivateChannelsPage() {
  if (!(await privateChannels())) {
    notFound();
  }

  let target = "/dashboard/payments/private-channels/instance";
  try {
    const client = await createSdpApiClient();
    const res = await client.fetch<PrivateChannelInstanceEnvelope>("/v1/private-channels/instance");
    if (res.instance?.isActive) {
      target = "/dashboard/payments/private-channels/overview";
    }
  } catch {
    // fall through — /instance is a safe default for a transient lookup failure
  }
  redirect(target);
}
