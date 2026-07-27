import { auth } from "@clerk/nextjs/server";
import type {
  ListProjectMembersResponse,
  PrivateChannelDto,
  PrivateChannelUserDto,
} from "@sdp/types";
import {
  hasPermission,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
  PRIVATE_CHANNEL_STATUSES,
} from "@sdp/types";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { privateChannels } from "@/flags";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { resolveDashboardAccess } from "@/lib/dashboard-access";
import {
  fetchMyPrivateChannelUser,
  fetchPrivateChannels,
  fetchPrivateChannelUsers,
} from "@/lib/private-channels";
import { PROJECT_COOKIE_NAME } from "@/lib/project-cookie";
import { createSdpApiClient } from "@/lib/sdp-api";
import { MembersTable } from "./members-table";

type ProjectMemberWithUser = ListProjectMembersResponse["members"][number];

async function loadProjectMembers(projectId: string | undefined): Promise<ProjectMemberWithUser[]> {
  if (!projectId) return [];
  try {
    const client = await createSdpApiClient();
    const res = await client.fetch<ListProjectMembersResponse>(
      `/v1/projects/${encodeURIComponent(projectId)}/members`
    );
    return res.members;
  } catch {
    return [];
  }
}

async function loadPrivateChannelData(): Promise<{
  users: PrivateChannelUserDto[];
  channels: PrivateChannelDto[];
  currentUser: PrivateChannelUserDto | null;
}> {
  try {
    const client = await createSdpApiClient();
    const [users, channels, currentUser] = await Promise.all([
      fetchPrivateChannelUsers(client),
      fetchPrivateChannels(client),
      fetchMyPrivateChannelUser(client),
    ]);
    return { users, channels, currentUser };
  } catch {
    return { users: [], channels: [], currentUser: null };
  }
}

export default async function PrivateChannelsMembersPage() {
  if (!(await privateChannels())) notFound();

  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const cookieStore = await cookies();
  const projectId = cookieStore.get(PROJECT_COOKIE_NAME)?.value;

  const [projectMembers, { users, channels, currentUser }] = await Promise.all([
    loadProjectMembers(projectId),
    loadPrivateChannelData(),
  ]);
  const canManageWorkspace = hasPermission(
    resolveDashboardAccess(orgRole).permissions,
    "projects:admin"
  );
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
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Invite SDP project users to your Private Channels workspace and manage which channels
            they belong to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersTable
            members={users}
            channels={channels}
            eligibleProjectMembers={projectMembers}
            canManageWorkspace={canManageWorkspace}
            manageableChannelIds={manageableChannelIds}
            ownedChannelIds={ownedChannelIds}
            currentPrivateChannelUserId={currentUser?.id ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
