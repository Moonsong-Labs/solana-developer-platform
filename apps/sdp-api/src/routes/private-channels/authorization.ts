import { PRIVATE_CHANNEL_MEMBERSHIP_ROLES, type PrivateChannelMembershipRole } from "@sdp/types";
import { getAuth, requireProjectId } from "@/lib/auth";
import { forbidden } from "@/lib/errors";
import { type AppContext, getPrivateChannelUserRepository } from "./context";

export function isAdminTier(c: AppContext): boolean {
  const { permissions } = getAuth(c);
  return permissions.includes("projects:admin") || permissions.includes("*");
}

export async function resolveChannelRole(
  c: AppContext,
  channelId: string
): Promise<PrivateChannelMembershipRole | null> {
  // Project admins are the fallback manager even when a channel has no admin membership.
  if (isAdminTier(c)) {
    return PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN;
  }

  const auth = getAuth(c);
  // API keys have no SDP user identity, so only admin-tier keys can resolve a role.
  if (!auth.userId) {
    return null;
  }

  const user = await getPrivateChannelUserRepository(c).findByProjectAndUser(
    { organizationId: auth.organizationId, projectId: requireProjectId(c) },
    auth.userId
  );
  if (!user) {
    return null;
  }

  const membership = (
    await getPrivateChannelUserRepository(c).listMembershipsForUser(user.id)
  ).find((item) => item.channel_id === channelId);
  return membership?.role ?? null;
}

export async function requireChannelManage(c: AppContext, channelId: string): Promise<void> {
  if ((await resolveChannelRole(c, channelId)) !== PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN) {
    throw forbidden("Channel admin access is required");
  }
}
