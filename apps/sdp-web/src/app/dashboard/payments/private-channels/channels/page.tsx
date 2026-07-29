import { auth } from "@clerk/nextjs/server";
import {
  hasPermission,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
  PRIVATE_CHANNEL_STATUSES,
} from "@sdp/types";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "@/i18n/server";
import { resolveDashboardAccess } from "@/lib/dashboard-access";
import { fetchMyPrivateChannelUser } from "@/lib/private-channels";
import { createSdpApiClient } from "@/lib/sdp-api";
import {
  PRIVATE_CHANNELS_INSTANCE_PATH,
  requirePrivateChannelsAccess,
} from "../private-channels-access";
import { PrivateChannelsLoadError } from "../private-channels-load-error";
import { loadChannels, loadInstance } from "../private-channels-page.data";
import { ChannelsManager } from "./channels-manager";

export default async function PrivateChannelsChannelsPage() {
  await requirePrivateChannelsAccess();

  const t = await getTranslations();
  const { orgRole } = await auth();

  const client = await createSdpApiClient();
  // Only redirect on a *known* inactive instance. A failed lookup used to throw
  // out of the page; now it falls through so the load error renders in place.
  const instance = await loadInstance(client);
  if (instance.ok && !instance.data?.isActive) {
    redirect(PRIVATE_CHANNELS_INSTANCE_PATH);
  }

  const [channels, currentUser] = await Promise.all([
    loadChannels(client),
    fetchMyPrivateChannelUser(client).catch(() => null),
  ]);

  const canManageWorkspace = hasPermission(
    resolveDashboardAccess(orgRole).permissions,
    "projects:admin"
  );
  const archivableChannelIds = canManageWorkspace
    ? channels.data.map((channel) => channel.id)
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
          <CardTitle>{t("DashboardPrivateChannels.channels.title")}</CardTitle>
          <CardDescription>{t("DashboardPrivateChannels.channels.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {channels.ok ? (
            <ChannelsManager
              initialChannels={channels.data}
              canCreate={canManageWorkspace}
              archivableChannelIds={archivableChannelIds}
            />
          ) : (
            <PrivateChannelsLoadError message={channels.error} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
