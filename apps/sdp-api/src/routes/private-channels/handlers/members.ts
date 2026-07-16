import type {
  PrivateChannelMembershipChannelDto,
  PrivateChannelUserDto,
} from "@sdp/types";
import { getDb } from "@/db";
import type {
  PrivateChannelMembershipWithChannelRow,
  PrivateChannelUserWithIdentityRow,
} from "@/db/repositories";
import { getAuth, requireProjectId } from "@/lib/auth";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { success } from "@/lib/response";
import { sendInviteEmail } from "@/lib/spc-invite-email";
import { inviteMember, mapPrivateChannelError } from "@/services/private-channels";
import type { AppContext } from "../context";
import {
  getPrivateChannelInstanceRepository,
  getPrivateChannelUserRepository,
} from "../context";
import { addMembershipBodySchema, inviteMemberBodySchema } from "../schemas";

function toDto(
  row: PrivateChannelUserWithIdentityRow,
  memberships: PrivateChannelMembershipWithChannelRow[]
): PrivateChannelUserDto {
  const channels: PrivateChannelMembershipChannelDto[] = memberships.map((m) => ({
    id: m.channel_id,
    name: m.channel_name,
    isDefault: m.channel_is_default,
  }));
  return {
    id: row.id,
    userId: row.user_id,
    email: row.user_email,
    name: row.user_name,
    walletVerified: row.wallet_verified,
    invitedAt: row.invited_at,
    channels,
  };
}

// Fetches an SDP user by id, verified to belong to this project via
// project_members. Returns { email, name } for downstream use. 404 otherwise.
async function loadProjectUser(
  c: AppContext,
  projectId: string,
  userId: string
): Promise<{ email: string; name: string | null }> {
  const row = await getDb(c.env)
    .prepare(
      `SELECT u.email AS email, u.name AS name
         FROM users u
         JOIN project_members pm ON pm.user_id = u.id
        WHERE pm.project_id = ?
          AND u.id = ?`
    )
    .bind(projectId, userId)
    .first<{ email: string; name: string | null }>();
  if (!row) {
    throw notFound("Project user");
  }
  return { email: row.email, name: row.name ?? null };
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
export const getMyPrivateChannelUser = async (c: AppContext) => {
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

  // Instance must exist, be active, and expose an auth service — we can't
  // register an SPC user without one.
  const instance = await getPrivateChannelInstanceRepository(c).getActiveByProject(scope);
  if (!instance) {
    throw new AppError(
      "CONFLICT",
      "No active Private Channel instance for this project. Connect one first."
    );
  }
  if (!instance.use_auth || !instance.auth_url) {
    throw badRequest(
      "The connected Private Channel instance has no auth service configured. Enable Use Auth on the instance before inviting members."
    );
  }

  const target = await loadProjectUser(c, projectId, parsed.data.userId);

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
  const deleted = await repo.deleteById({ organizationId: auth.organizationId, projectId }, id);
  if (!deleted) throw notFound("Private channel user");

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

  // Channel scoping check: verify the channel is under the active instance for
  // this project. Reuses the existing repository via a targeted count query.
  const channelRow = await getDb(c.env)
    .prepare(
      `SELECT 1
         FROM private_channels c
         JOIN private_channel_instances i ON i.id = c.instance_id
        WHERE c.id = ?
          AND i.organization_id = ?
          AND i.project_id = ?`
    )
    .bind(channelId, scope.organizationId, projectId)
    .first<{ [k: string]: unknown }>();
  if (!channelRow) throw notFound("Channel");

  const membership = await repo.addMembership({
    channelId,
    privateChannelUserId: user.id,
    addedBy: auth.userId ?? null,
  });
  return success(c, { membership });
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

  // Scope check: user belongs to this project.
  const user = await repo.getById(scope, userId);
  if (!user) throw notFound("Private channel user");

  const removed = await repo.removeMembership(channelId, userId);
  if (!removed) throw notFound("Membership");

  return success(c, { removed: true });
};
