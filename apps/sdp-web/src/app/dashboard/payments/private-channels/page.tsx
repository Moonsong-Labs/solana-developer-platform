import { auth } from "@clerk/nextjs/server";
import type { PrivateChannelInstance } from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { PrivateChannelsConnectForm } from "./private-channels-connect-form";

async function fetchInitialInstance(): Promise<PrivateChannelInstance | null> {
  try {
    const client = await createSdpApiClient();
    const response = await client.fetch<{ instance: PrivateChannelInstance | null }>(
      "/v1/private-channels/instance"
    );
    return response.instance;
  } catch {
    // 403 (flag off in sdp-api), 401, and network errors all degrade to "no
    // persisted row" so the form still renders with sandbox defaults.
    return null;
  }
}

export default async function PrivateChannelsPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) {
    redirect(await getAuthEntryPath());
  }
  if (!orgId) {
    redirect("/dashboard");
  }

  const initialInstance = await fetchInitialInstance();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Connect Private Channel</CardTitle>
          <CardDescription>Point SDP at a Solana Private Channels instance.</CardDescription>
        </CardHeader>
        <CardContent>
          <PrivateChannelsConnectForm initialInstance={initialInstance} />
        </CardContent>
      </Card>
    </div>
  );
}
