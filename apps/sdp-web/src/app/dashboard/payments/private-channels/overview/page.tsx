import { auth } from "@clerk/nextjs/server";
import type {
  PrivateChannelInstance,
  PrivateChannelInstanceOverview,
  PrivateChannelUserDto,
} from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import {
  fetchMyPrivateChannelUser,
  fetchPrivateChannelOverview,
} from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { InstanceOverviewCard } from "./instance-overview-card";

async function loadOverview(): Promise<{
  instance: PrivateChannelInstance;
  overview: PrivateChannelInstanceOverview;
} | null> {
  try {
    const client = await createSdpApiClient();
    return await fetchPrivateChannelOverview(client);
  } catch {
    // 404 → no active instance; caller routes to /instance
    return null;
  }
}

async function loadViewer(): Promise<PrivateChannelUserDto | null> {
  try {
    const client = await createSdpApiClient();
    return await fetchMyPrivateChannelUser(client);
  } catch {
    return null;
  }
}

export default async function PrivateChannelsOverviewPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const [data, viewer] = await Promise.all([loadOverview(), loadViewer()]);
  if (!data) {
    redirect("/dashboard/payments/private-channels/instance");
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>Live status of your connected instance.</CardDescription>
        </CardHeader>
        <CardContent>
          <InstanceOverviewCard
            instance={data.instance}
            overview={data.overview}
            viewer={viewer}
          />
        </CardContent>
      </Card>
    </div>
  );
}
