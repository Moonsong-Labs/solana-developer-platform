import { auth } from "@clerk/nextjs/server";
import {
  hasPermission,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
  PRIVATE_CHANNEL_STATUSES,
} from "@sdp/types";
import { cookies } from "next/headers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "@/i18n/server";
import { resolveDashboardAccess } from "@/lib/dashboard-access";
import { fetchMyPrivateChannelUser } from "@/lib/private-channels";
import { PROJECT_COOKIE_NAME } from "@/lib/project-cookie";
import { createSdpApiClient } from "@/lib/sdp-api";
import { requirePrivateChannelsAccess } from "../private-channels-access";
import { PrivateChannelsLoadError } from "../private-channels-load-error";
import { loadMembers } from "../private-channels-page.data";
import { MembersTable } from "./members-table";

export default async function PrivateChannelsMembersPage() {
  await requirePrivateChannelsAccess();

  const t = await getTranslations();
  const { orgRole } = await auth();

  const [client, cookieStore] = await Promise.all([createSdpApiClient(), cookies()]);
  const projectId = cookieStore.get(PROJECT_COOKIE_NAME)?.value;

  const [members, currentUser] = await Promise.all([
    loadMembers(client, projectId),
    fetchMyPrivateChannelUser(client).catch(() => null),
  ]);

  const canManageWorkspace = hasPermission(
    resolveDashboardAccess(orgRole).permissions,
    "projects:admin"
  );
  const users = members.data.users;
  const channels = members.data.channels;
  const manageableChannelIds = canManageWorkspace
    ? [
        ...new Set([
          ...channels.map((channel) => channel.id),
          ...users.flatMap((user) => user.channels.map((channel) => channel.id)),
        ]),
      ]
    : (currentUser?.channels
        .filter(
          (channel) =>
            channel.status === PRIVATE_CHANNEL_STATUSES.ACTIVE &&
            (channel.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER ||
              channel.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN)
        )
        .map((channel) => channel.id) ?? []);
  const ownedChannelIds =
    currentUser?.channels
      .filter(
        (channel) =>
          channel.status === PRIVATE_CHANNEL_STATUSES.ACTIVE &&
          channel.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER
      )
      .map((channel) => channel.id) ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("DashboardPrivateChannels.members.title")}</CardTitle>
          <CardDescription>{t("DashboardPrivateChannels.members.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {members.ok ? (
            <MembersTable
              members={users}
              channels={channels}
              eligibleProjectMembers={members.data.projectMembers}
              canManageWorkspace={canManageWorkspace}
              manageableChannelIds={manageableChannelIds}
              ownedChannelIds={ownedChannelIds}
              currentPrivateChannelUserId={currentUser?.id ?? null}
            />
          ) : (
            <PrivateChannelsLoadError message={members.error} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
