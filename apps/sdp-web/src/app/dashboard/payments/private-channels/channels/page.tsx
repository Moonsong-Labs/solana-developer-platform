import { auth } from "@clerk/nextjs/server";
import {
  hasPermission,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
  PRIVATE_CHANNEL_STATUSES,
  type PrivateChannelDto,
  type PrivateChannelUserDto,
} from "@sdp/types";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { resolveDashboardAccess } from "@/lib/dashboard-access";
import {
  fetchMyPrivateChannelUser,
  fetchPrivateChannelInstance,
  fetchPrivateChannels,
} from "@/lib/private-channels";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";
import { createSdpApiClient } from "@/lib/sdp-api";
import { ChannelsManager } from "./channels-manager";

async function loadChannels(): Promise<{
  channels: PrivateChannelDto[];
  currentUser: PrivateChannelUserDto | null;
}> {
  const client = await createSdpApiClient();
  const { instance } = await fetchPrivateChannelInstance(client);
  if (!instance?.isActive) {
    redirect("/dashboard/payments/private-channels/instance");
  }
  const [channels, currentUser] = await Promise.all([
    fetchPrivateChannels(client),
    fetchMyPrivateChannelUser(client),
  ]);
  return { channels, currentUser };
}

export default async function PrivateChannelsChannelsPage() {
  if (!isPrivateChannelsDashboardEnabled()) {
    notFound();
  }

  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const { channels, currentUser } = await loadChannels();
  const canManageWorkspace = hasPermission(
    resolveDashboardAccess(orgRole).permissions,
    "projects:admin"
  );
  const archivableChannelIds = canManageWorkspace
    ? channels.map((channel) => channel.id)
    : (currentUser?.channels
        .filter(
          (channel) =>
            channel.status === PRIVATE_CHANNEL_STATUSES.ACTIVE &&
            channel.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER
        )
        .map((channel) => channel.id) ?? []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>
            Logical channels group activity within your connected instance. The default channel is
            created automatically and cannot be archived.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChannelsManager
            initialChannels={channels}
            canCreate={canManageWorkspace}
            archivableChannelIds={archivableChannelIds}
          />
        </CardContent>
      </Card>
    </div>
  );
}
