import type { PrivateChannelInstanceEnvelope } from "@sdp/types";
import type { ReactNode } from "react";
import { createSdpApiClient } from "@/lib/sdp-api";
import { PrivateChannelsHeaderTabs } from "./private-channels-header-tabs";

async function isInstanceConnected(): Promise<boolean> {
  try {
    const client = await createSdpApiClient();
    const res = await client.fetch<PrivateChannelInstanceEnvelope>(
      "/v1/private-channels/instance"
    );
    return res.instance?.isActive === true;
  } catch {
    return false;
  }
}

export default async function PrivateChannelsLayout({ children }: { children: ReactNode }) {
  const isConnected = await isInstanceConnected();
  return (
    <>
      <PrivateChannelsHeaderTabs isConnected={isConnected} />
      {children}
    </>
  );
}
