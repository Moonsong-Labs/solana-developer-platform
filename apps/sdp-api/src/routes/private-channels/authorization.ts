import { PRIVATE_CHANNEL_MEMBERSHIP_ROLES, type PrivateChannelMembershipRole } from "@sdp/types";
import { getAuth, requireProjectId } from "@/lib/auth";
import { forbidden } from "@/lib/errors";
import { type AppContext, getPrivateChannelUserRepository } from "./context";

export function hasProjectAdminAccess(c: AppContext): boolean {
  const { permissions } = getAuth(c);
  return permissions.includes("projects:admin") || permissions.includes("*");
}

async function resolveMembershipRole(
  c: AppContext,
  channelId: string
): Promise<PrivateChannelMembershipRole | null> {
  const auth = getAuth(c);
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

export async function resolveChannelRole(
  c: AppContext,
  channelId: string
): Promise<PrivateChannelMembershipRole | null> {
  // Project admins are fallback managers, while owner-only actions use the
  // caller's explicit channel membership below.
  if (hasProjectAdminAccess(c)) {
    return PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN;
  }
  return resolveMembershipRole(c, channelId);
}

export async function requireChannelManage(c: AppContext, channelId: string): Promise<void> {
  const role = await resolveChannelRole(c, channelId);
  if (
    role !== PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER &&
    role !== PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN
  ) {
    throw forbidden("Channel admin access is required");
  }
}

export async function requireChannelOwner(c: AppContext, channelId: string): Promise<void> {
  if ((await resolveMembershipRole(c, channelId)) !== PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER) {
    throw forbidden("Channel owner access is required");
  }
}
