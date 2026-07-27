import {
  PRIVATE_CHANNEL_EVENT_TYPES,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
  PRIVATE_CHANNEL_STATUSES,
  type PrivateChannelMembershipChannelDto,
  type PrivateChannelMembershipDto,
  type PrivateChannelStatusDto,
  type PrivateChannelUserDto,
} from "@sdp/types";
import type {
  PrivateChannelMembershipRow,
  PrivateChannelMembershipWithChannelRow,
  PrivateChannelUserRepository,
  PrivateChannelUserWithIdentityRow,
} from "@/db/repositories";
import { getAuth, requireProjectId } from "@/lib/auth";
import { AppError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { success } from "@/lib/response";
import { sendInviteEmail } from "@/lib/spc-invite-email";
import { inviteMember, mapPrivateChannelError } from "@/services/private-channels";
import { requireChannelManage, requireChannelOwner } from "../authorization";
import type { AppContext } from "../context";
import {
  getPrivateChannelInstanceRepository,
  getPrivateChannelRepository,
  getPrivateChannelUserRepository,
  getProjectUserRepository,
} from "../context";
import { emitMember } from "../helpers";
import {
  addMembershipBodySchema,
  inviteMemberBodySchema,
  updateMembershipRoleBodySchema,
} from "../schemas";

function toDto(
  row: PrivateChannelUserWithIdentityRow,
  memberships: PrivateChannelMembershipWithChannelRow[]
): PrivateChannelUserDto {
  const channels: PrivateChannelMembershipChannelDto[] = memberships.map((m) => ({
    id: m.channel_id,
    name: m.channel_name,
    isDefault: m.channel_is_default,
    status: m.channel_status,
    role: m.role,
  }));
  return {
    id: row.id,
    userId: row.user_id,
    email: row.user_email,
    name: row.user_name,
    verifiedWalletCount: row.verified_wallet_count,
    invitedAt: row.invited_at,
    channels,
  };
}

function toMembershipDto(row: PrivateChannelMembershipRow): PrivateChannelMembershipDto {
  return {
    id: row.id,
    channelId: row.channel_id,
    privateChannelUserId: row.private_channel_user_id,
    role: row.role,
    addedBy: row.added_by,
    addedAt: row.added_at,
  };
}

async function assertMembershipCanBeRemoved(
  repo: PrivateChannelUserRepository,
  membership: PrivateChannelMembershipRow,
  channelStatus: PrivateChannelStatusDto
): Promise<void> {
  if (channelStatus === PRIVATE_CHANNEL_STATUSES.ARCHIVED) {
    return;
  }

  if (membership.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER) {
    throw conflict("Transfer channel ownership before removing the owner");
  }

  if (
    membership.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN &&
    (await repo.countChannelManagers(membership.channel_id)) <= 1
  ) {
    throw conflict("The last channel manager cannot be removed or demoted");
  }
}

export const listPrivateChannelUsers = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const scope = { organizationId: auth.organizationId, projectId };

  const repo = getPrivateChannelUserRepository(c);
  const [rows, membershipsByUser] = await Promise.all([
    repo.listByProject(scope),
    repo.listMembershipsByProject(scope),
  ]);

  const users: PrivateChannelUserDto[] = rows.map((row) =>
    toDto(row, membershipsByUser.get(row.id) ?? [])
  );
  return success(c, { users });
};

// Caller's own workspace membership for the active project. Returns { user: null }
// when the caller isn't a member — the UI uses that to decide whether to show
// invitee-specific affordances (e.g. the wallet-verify button).
export const getAuthenticatedPrivateChannelUser = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  if (!auth.userId) {
    return success(c, { user: null });
  }

  const repo = getPrivateChannelUserRepository(c);
  const scope = { organizationId: auth.organizationId, projectId };
  const row = await repo.getByProjectAndUser(scope, auth.userId);
  if (!row) return success(c, { user: null });

  const memberships = await repo.listMembershipsForUser(row.id);
  return success(c, { user: toDto(row, memberships) });
};

export const getPrivateChannelUser = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const id = c.req.param("privateChannelUserId");
  if (!id) throw badRequest("privateChannelUserId is required");

  const repo = getPrivateChannelUserRepository(c);
  const row = await repo.getById({ organizationId: auth.organizationId, projectId }, id);
  if (!row) throw notFound("Private channel user");

  const memberships = await repo.listMembershipsForUser(row.id);
  return success(c, { user: toDto(row, memberships) });
};

export const invitePrivateChannelUser = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);

  const body = await c.req.json();
  const parsed = inviteMemberBodySchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Invalid invite payload");
  }

  const scope = { organizationId: auth.organizationId, projectId };

  // Instance must exist and be active — SPC user registration requires the
  // configured auth service (guaranteed present on every active instance).
  const instance = await getPrivateChannelInstanceRepository(c).getActiveByProject(scope);
  if (!instance) {
    throw new AppError(
      "CONFLICT",
      "No active Private Channel instance for this project. Connect one first."
    );
  }

  const target = await getProjectUserRepository(c).getByProjectAndUserId(
    projectId,
    parsed.data.userId
  );
  if (!target) throw notFound("Project user");

  try {
    const repo = getPrivateChannelUserRepository(c);
    const { member, inviteToken } = await inviteMember(c.env, repo, {
      ...scope,
      authUrl: instance.auth_url,
      targetUserId: parsed.data.userId,
      targetUserEmail: target.email,
      invitedBy: auth.userId ?? null,
    });

    // Email is scaffolded — log the URL so admins can copy it from stdout.
    const frontendUrl = c.env.FRONTEND_URL ?? "";
    const inviteUrl = frontendUrl
      ? `${frontendUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(inviteToken)}`
      : `<invite token: ${inviteToken}>`;
    await sendInviteEmail({
      to: target.email,
      inviteUrl,
      invitedByName: null,
    });

    return success(c, { user: toDto(member, []), inviteUrl });
  } catch (error) {
    throw mapPrivateChannelError(error);
  }
};

export const deletePrivateChannelUser = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const id = c.req.param("privateChannelUserId");
  if (!id) throw badRequest("privateChannelUserId is required");

  const repo = getPrivateChannelUserRepository(c);
  const scope = { organizationId: auth.organizationId, projectId };
  const user = await repo.getById(scope, id);
  if (!user) throw notFound("Private channel user");

  const memberships = await repo.listMembershipsForUser(user.id);
  const channelRepo = getPrivateChannelRepository(c);
  for (const membership of memberships) {
    const channel = await channelRepo.findInProject({
      ...scope,
      channelId: membership.channel_id,
    });
    if (channel) {
      await assertMembershipCanBeRemoved(repo, membership, channel.status);
    }
  }
  const instance = await getPrivateChannelInstanceRepository(c).getActiveByProject(scope);

  const deleted = await repo.deleteById(scope, id);
  if (!deleted) {
    if (await repo.getById(scope, id)) {
      throw conflict("Transfer ownership or assign another manager before deleting this user");
    }
    throw notFound("Private channel user");
  }

  // Emit per-channel revokes using memberships captured before delete.
  // Best-effort when no active instance remains (we can't attribute an instance).
  if (instance) {
    const eventScope = {
      organizationId: instance.organization_id,
      projectId: instance.project_id,
      instanceId: instance.id,
    };
    for (const membership of memberships) {
      await emitMember(c, eventScope, PRIVATE_CHANNEL_EVENT_TYPES.MEMBER_REVOKED, {
        channelId: membership.channel_id,
        payload: {
          privateChannelUserId: user.id,
          targetUserId: user.user_id,
          reason: "user_deleted",
        },
      });
    }
  }

  // SPC has no delete-user endpoint; the SPC credential is intentionally
  // orphaned. Log so operators can spot excess accumulation if needed.
  console.info("[members] deleted private_channel_users row; SPC credential remains orphaned", {
    id,
    organizationId: auth.organizationId,
    projectId,
  });

  return success(c, { deleted: true });
};

export const addChannelMembership = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const channelId = c.req.param("channelId");
  if (!channelId) throw badRequest("channelId is required");

  const body = await c.req.json();
  const parsed = addMembershipBodySchema.safeParse(body);
  if (!parsed.success) throw badRequest("Invalid membership payload");

  const scope = { organizationId: auth.organizationId, projectId };
  const repo = getPrivateChannelUserRepository(c);

  const user = await repo.getById(scope, parsed.data.privateChannelUserId);
  if (!user) throw notFound("Private channel user");

  const channel = await getPrivateChannelRepository(c).findInProject({
    ...scope,
    channelId,
  });
  if (!channel) throw notFound("Channel");
  await requireChannelManage(c, channelId);

  const existing = (await repo.listMembershipsForUser(user.id)).find(
    (m) => m.channel_id === channelId
  );
  // Adding is idempotent, but it must not double as a role change: that path carries
  // stricter authorization (owner transfer, last-manager guard) and its own event.
  // An auto-promoted first owner is exempt so identical retries stay idempotent.
  if (
    existing &&
    existing.role !== parsed.data.role &&
    existing.role !== PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER
  ) {
    throw conflict("User is already in this channel; change their role instead");
  }

  const membership = await repo.addMembership({
    channelId,
    privateChannelUserId: user.id,
    addedBy: auth.userId ?? null,
    role: parsed.data.role,
  });

  // Only emit on a genuine add (membership insert is idempotent).
  if (!existing) {
    await emitMember(
      c,
      {
        organizationId: channel.organization_id,
        projectId: channel.project_id,
        instanceId: channel.instance_id,
      },
      PRIVATE_CHANNEL_EVENT_TYPES.MEMBER_ADDED,
      {
        channelId,
        payload: {
          privateChannelUserId: user.id,
          targetUserId: user.user_id,
          membershipId: membership.id,
          role: membership.role,
        },
      }
    );
  }

  return success(c, { membership: toMembershipDto(membership) });
};

export const removeChannelMembership = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const channelId = c.req.param("channelId");
  const userId = c.req.param("privateChannelUserId");
  if (!channelId || !userId) {
    throw badRequest("channelId and privateChannelUserId are required");
  }

  const scope = { organizationId: auth.organizationId, projectId };
  const repo = getPrivateChannelUserRepository(c);

  // Scope checks: both the user and the channel must belong to this project.
  const user = await repo.getById(scope, userId);
  if (!user) throw notFound("Private channel user");

  const channel = await getPrivateChannelRepository(c).findInProject({
    ...scope,
    channelId,
  });
  if (!channel) throw notFound("Channel");

  // Members may leave by deleting their own row; changing anyone else requires admin.
  if (user.user_id !== auth.userId) {
    await requireChannelManage(c, channelId);
  }

  const membership = (await repo.listMembershipsForUser(user.id)).find(
    (item) => item.channel_id === channelId
  );
  if (!membership) throw notFound("Membership");
  await assertMembershipCanBeRemoved(repo, membership, channel.status);

  const removed = await repo.removeMembership(
    channelId,
    userId,
    channel.status === PRIVATE_CHANNEL_STATUSES.ARCHIVED
  );
  if (!removed) throw notFound("Membership");

  await emitMember(
    c,
    {
      organizationId: channel.organization_id,
      projectId: channel.project_id,
      instanceId: channel.instance_id,
    },
    PRIVATE_CHANNEL_EVENT_TYPES.MEMBER_REVOKED,
    {
      channelId,
      payload: {
        privateChannelUserId: user.id,
        targetUserId: user.user_id,
      },
    }
  );

  return success(c, { removed: true });
};

export const updateChannelMembershipRole = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const channelId = c.req.param("channelId");
  const privateChannelUserId = c.req.param("privateChannelUserId");
  if (!channelId || !privateChannelUserId) {
    throw badRequest("channelId and privateChannelUserId are required");
  }

  const parsed = updateMembershipRoleBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw badRequest("Invalid membership role payload");
  }

  const scope = { organizationId: auth.organizationId, projectId };
  const repo = getPrivateChannelUserRepository(c);
  const user = await repo.getById(scope, privateChannelUserId);
  if (!user) {
    throw notFound("Private channel user");
  }

  const channel = await getPrivateChannelRepository(c).findInProject({
    ...scope,
    channelId,
  });
  if (!channel) {
    throw notFound("Channel");
  }
  const current = (await repo.listMembershipsForUser(user.id)).find(
    (membership) => membership.channel_id === channelId
  );
  if (!current) {
    throw notFound("Membership");
  }

  let currentOwnerId: string | null = null;
  if (parsed.data.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER) {
    await requireChannelOwner(c, channelId);
    const currentOwner = auth.userId ? await repo.findByProjectAndUser(scope, auth.userId) : null;
    if (!currentOwner) {
      throw forbidden("Channel owner access is required");
    }
    currentOwnerId = currentOwner.id;
  } else {
    await requireChannelManage(c, channelId);
  }

  // Keep role updates idempotent and avoid duplicate MEMBER_ROLE_CHANGED events.
  if (current.role === parsed.data.role) {
    return success(c, { membership: toMembershipDto(current) });
  }

  if (current.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER) {
    throw forbidden("Transfer ownership instead of changing the owner's role");
  }

  if (parsed.data.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER) {
    if (!currentOwnerId) {
      throw forbidden("Channel owner access is required");
    }
    const transferred = await repo.transferChannelOwnership(
      channelId,
      privateChannelUserId,
      currentOwnerId
    );
    if (!transferred) {
      throw conflict("Channel ownership could not be transferred");
    }
    const previousOwner = await repo.getById(
      scope,
      transferred.previousOwner.private_channel_user_id
    );
    if (previousOwner) {
      await emitMember(
        c,
        {
          organizationId: channel.organization_id,
          projectId: channel.project_id,
          instanceId: channel.instance_id,
        },
        PRIVATE_CHANNEL_EVENT_TYPES.MEMBER_ROLE_CHANGED,
        {
          channelId,
          payload: {
            privateChannelUserId: previousOwner.id,
            targetUserId: previousOwner.user_id,
            oldRole: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
            newRole: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
          },
        }
      );
    }
    await emitMember(
      c,
      {
        organizationId: channel.organization_id,
        projectId: channel.project_id,
        instanceId: channel.instance_id,
      },
      PRIVATE_CHANNEL_EVENT_TYPES.MEMBER_ROLE_CHANGED,
      {
        channelId,
        payload: {
          privateChannelUserId: user.id,
          targetUserId: user.user_id,
          oldRole: transferred.ownerPreviousRole,
          newRole: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
        },
      }
    );
    return success(c, { membership: toMembershipDto(transferred.owner) });
  }

  if (
    parsed.data.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER ||
    parsed.data.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.VIEWER
  ) {
    await assertMembershipCanBeRemoved(repo, current, channel.status);
  }

  const updated = await repo.updateMembershipRole(
    channelId,
    privateChannelUserId,
    parsed.data.role
  );
  if (!updated) {
    throw notFound("Membership");
  }

  await emitMember(
    c,
    {
      organizationId: channel.organization_id,
      projectId: channel.project_id,
      instanceId: channel.instance_id,
    },
    PRIVATE_CHANNEL_EVENT_TYPES.MEMBER_ROLE_CHANGED,
    {
      channelId,
      payload: {
        privateChannelUserId: user.id,
        targetUserId: user.user_id,
        oldRole: updated.previousRole,
        newRole: updated.membership.role,
      },
    }
  );

  return success(c, { membership: toMembershipDto(updated.membership) });
};
