import type { PrivateChannelInstanceEnvelope } from "@sdp/types";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { privateChannels } from "@/flags";
import { createSdpApiClient } from "@/lib/sdp-api";
import { PrivateChannelsHeaderTabs } from "./private-channels-header-tabs";

async function isInstanceConnected(): Promise<boolean> {
  try {
    const client = await createSdpApiClient();
    const res = await client.fetch<PrivateChannelInstanceEnvelope>("/v1/private-channels/instance");
    return res.instance?.isActive === true;
  } catch {
    return false;
  }
}

export default async function PrivateChannelsLayout({ children }: { children: ReactNode }) {
  // Gate before the instance lookup: every leaf page checks the flag too, so without
  // this a hand-typed URL spends an authenticated API round trip only to 404, and the
  // header tabs render around the child's notFound().
  if (!(await privateChannels())) {
    notFound();
  }

  const isConnected = await isInstanceConnected();
  return (
    <>
      <PrivateChannelsHeaderTabs isConnected={isConnected} />
      {children}
    </>
  );
}
