import { auth } from "@clerk/nextjs/server";
import type { PrivateChannelDto } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { fetchPrivateChannelInstance, fetchPrivateChannels } from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { ChannelsManager } from "./channels-manager";

async function loadChannels(): Promise<PrivateChannelDto[]> {
  const client = await createSdpApiClient();
  const { instance } = await fetchPrivateChannelInstance(client);
  if (!instance?.isActive) {
    redirect("/dashboard/payments/private-channels/instance");
  }
  return fetchPrivateChannels(client);
}

export default async function PrivateChannelsChannelsPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const channels = await loadChannels();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>
            Logical channels group activity within your connected instance. The default channel is
            created automatically and cannot be deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChannelsManager initialChannels={channels} />
        </CardContent>
      </Card>
    </div>
  );
}
