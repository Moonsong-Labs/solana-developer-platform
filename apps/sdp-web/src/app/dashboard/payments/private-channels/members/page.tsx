import { auth } from "@clerk/nextjs/server";
import type {
  ListProjectMembersResponse,
  PrivateChannelDto,
  PrivateChannelUserDto,
} from "@sdp/types";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { privateChannels } from "@/flags";
import { getAuthEntryPath } from "@/lib/auth-entry";
import { fetchPrivateChannels, fetchPrivateChannelUsers } from "@/lib/private-channels";
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
}> {
  try {
    const client = await createSdpApiClient();
    const [users, channels] = await Promise.all([
      fetchPrivateChannelUsers(client),
      fetchPrivateChannels(client),
    ]);
    return { users, channels };
  } catch {
    return { users: [], channels: [] };
  }
}

export default async function PrivateChannelsMembersPage() {
  if (!(await privateChannels())) notFound();

  const { userId, orgId } = await auth();
  if (!userId) redirect(await getAuthEntryPath());
  if (!orgId) redirect("/dashboard");

  const cookieStore = await cookies();
  const projectId = cookieStore.get(PROJECT_COOKIE_NAME)?.value;

  const [projectMembers, { users, channels }] = await Promise.all([
    loadProjectMembers(projectId),
    loadPrivateChannelData(),
  ]);

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
          />
        </CardContent>
      </Card>
    </div>
  );
}
