import {
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
  type PrivateChannelMembershipRole,
  type PrivateChannelStatusDto,
} from "@sdp/types";
import type { AppDb, DatabaseExecutor } from "@/db";
import {
  type AddMembershipInput,
  type CreatePrivateChannelUserInput,
  generatePrivateChannelMembershipId,
  type PrivateChannelMembershipRow,
  type PrivateChannelMembershipWithChannelRow,
  type PrivateChannelUserRepository,
  type PrivateChannelUserRow,
  type PrivateChannelUserWithIdentityRow,
  type ProjectScope,
} from "./private-channel-user.repository";

function mapUserRow(row: Record<string, unknown>): PrivateChannelUserRow {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    project_id: row.project_id as string,
    user_id: row.user_id as string,
    spc_user_id: (row.spc_user_id ?? null) as string | null,
    spc_username: (row.spc_username ?? null) as string | null,
    spc_credential_ciphertext: (row.spc_credential_ciphertext ?? null) as string | null,
    invited_by: (row.invited_by ?? null) as string | null,
    invite_token: (row.invite_token ?? null) as string | null,
    invited_at: row.invited_at as string,
    accepted_at: (row.accepted_at ?? null) as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapUserWithIdentityRow(row: Record<string, unknown>): PrivateChannelUserWithIdentityRow {
  return {
    ...mapUserRow(row),
    user_email: row.user_email as string,
    user_name: (row.user_name ?? null) as string | null,
    verified_wallet_count: Number(row.verified_wallet_count ?? 0),
  };
}

function mapMembershipWithChannelRow(
  row: Record<string, unknown>
): PrivateChannelMembershipWithChannelRow {
  return {
    id: row.id as string,
    channel_id: row.channel_id as string,
    private_channel_user_id: row.private_channel_user_id as string,
    role: row.role as PrivateChannelMembershipRole,
    added_by: (row.added_by ?? null) as string | null,
    added_at: row.added_at as string,
    channel_name: row.channel_name as string,
    channel_is_default: Boolean(row.channel_is_default),
    channel_status: row.channel_status as PrivateChannelStatusDto,
  };
}

/** Callers must already hold the channel lock for this answer to stay true. */
async function hasOtherManager(
  tx: DatabaseExecutor,
  channelId: string,
  privateChannelUserId: string
): Promise<boolean> {
  const row = await tx.queryOne<{ id: string }>(
    `SELECT id
       FROM private_channel_memberships
      WHERE channel_id = ?
        AND private_channel_user_id <> ?
        AND role IN (?, ?)
      LIMIT 1`,
    [
      channelId,
      privateChannelUserId,
      PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
      PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
    ]
  );
  return row !== null;
}

function mapMembershipRow(row: Record<string, unknown>): PrivateChannelMembershipRow {
  return {
    id: row.id as string,
    channel_id: row.channel_id as string,
    private_channel_user_id: row.private_channel_user_id as string,
    role: row.role as PrivateChannelMembershipRole,
    added_by: (row.added_by ?? null) as string | null,
    added_at: row.added_at as string,
  };
}

const USER_SELECT = `
  pcu.*,
  u.email AS user_email,
  u.name  AS user_name,
  (
    SELECT COUNT(*)
      FROM private_channel_verified_wallets vw
     WHERE vw.user_id = pcu.id
       AND vw.instance_id = (
             SELECT id FROM private_channel_instances
              WHERE project_id = pcu.project_id AND is_active = TRUE
           )
  ) AS verified_wallet_count
`;

export function createPostgresPrivateChannelUserRepository(
  db: AppDb
): PrivateChannelUserRepository {
  return {
    async listByProject(scope: ProjectScope) {
      const { results = [] } = await db
        .prepare(
          `SELECT ${USER_SELECT}
             FROM private_channel_users pcu
             INNER JOIN users u ON u.id = pcu.user_id
            WHERE pcu.organization_id = ?
              AND pcu.project_id = ?
            ORDER BY pcu.created_at DESC, pcu.id DESC`
        )
        .bind(scope.organizationId, scope.projectId)
        .all<Record<string, unknown>>();
      return results.map(mapUserWithIdentityRow);
    },

    async getById(scope, id) {
      const row = await db
        .prepare(
          `SELECT ${USER_SELECT}
             FROM private_channel_users pcu
             INNER JOIN users u ON u.id = pcu.user_id
            WHERE pcu.id = ?
              AND pcu.organization_id = ?
              AND pcu.project_id = ?`
        )
        .bind(id, scope.organizationId, scope.projectId)
        .first<Record<string, unknown>>();
      return row ? mapUserWithIdentityRow(row) : null;
    },

    async findByProjectAndUser(scope, userId) {
      const row = await db
        .prepare(
          `SELECT * FROM private_channel_users
            WHERE organization_id = ?
              AND project_id = ?
              AND user_id = ?`
        )
        .bind(scope.organizationId, scope.projectId, userId)
        .first<Record<string, unknown>>();
      return row ? mapUserRow(row) : null;
    },

    async getByProjectAndUser(scope, userId) {
      const row = await db
        .prepare(
          `SELECT ${USER_SELECT}
             FROM private_channel_users pcu
             INNER JOIN users u ON u.id = pcu.user_id
            WHERE pcu.organization_id = ?
              AND pcu.project_id = ?
              AND pcu.user_id = ?`
        )
        .bind(scope.organizationId, scope.projectId, userId)
        .first<Record<string, unknown>>();
      return row ? mapUserWithIdentityRow(row) : null;
    },

    async create(input: CreatePrivateChannelUserInput) {
      const row = await db
        .prepare(
          `INSERT INTO private_channel_users (
               id, organization_id, project_id, user_id,
               spc_user_id, spc_username, spc_credential_ciphertext,
               invited_by, invite_token
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`
        )
        .bind(
          `pcu_${crypto.randomUUID()}`,
          input.organizationId,
          input.projectId,
          input.userId,
          input.spcUserId,
          input.spcUsername,
          input.spcCredentialCiphertext,
          input.invitedBy,
          input.inviteToken
        )
        .first<{ id: string }>();
      if (!row) throw new Error("private_channel_users insert returned no id");

      const full = await db
        .prepare(
          `SELECT ${USER_SELECT}
             FROM private_channel_users pcu
             INNER JOIN users u ON u.id = pcu.user_id
            WHERE pcu.id = ?`
        )
        .bind(row.id)
        .first<Record<string, unknown>>();
      if (!full) throw new Error("private_channel_users insert not readable");
      return mapUserWithIdentityRow(full);
    },

    async deleteById(scope, id) {
      return db.transaction(async (tx) => {
        // Serialize against membership changes and ownership transfers in every
        // active channel this workspace user belongs to.
        await tx.queryMany(
          `SELECT c.id
             FROM private_channel_memberships m
             INNER JOIN private_channels c ON c.id = m.channel_id
            WHERE m.private_channel_user_id = ?
              AND c.status = 'active'
            ORDER BY c.id
            FOR UPDATE OF c`,
          [id]
        );
        const row = await tx.queryOne<{ id: string }>(
          `DELETE FROM private_channel_users pcu
            WHERE pcu.id = ?
              AND pcu.organization_id = ?
              AND pcu.project_id = ?
              AND NOT EXISTS (
                SELECT 1
                  FROM private_channel_memberships m
                  INNER JOIN private_channels c ON c.id = m.channel_id
                 WHERE m.private_channel_user_id = pcu.id
                   AND c.status = 'active'
                   AND (
                     m.role = ?
                     OR (
                       m.role = ?
                       AND NOT EXISTS (
                         SELECT 1
                           FROM private_channel_memberships manager
                          WHERE manager.channel_id = m.channel_id
                            AND manager.private_channel_user_id <> pcu.id
                            AND manager.role IN (?, ?)
                       )
                     )
                   )
              )
          RETURNING pcu.id`,
          [
            id,
            scope.organizationId,
            scope.projectId,
            PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
            PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
            PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
            PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
          ]
        );
        return row !== null;
      });
    },

    async listMembershipsByProject(scope) {
      const { results = [] } = await db
        .prepare(
          `SELECT m.*,
                  c.name       AS channel_name,
                  c.is_default AS channel_is_default,
                  c.status     AS channel_status
             FROM private_channel_memberships m
             INNER JOIN private_channels c        ON c.id = m.channel_id
             INNER JOIN private_channel_users pcu ON pcu.id = m.private_channel_user_id
            WHERE pcu.organization_id = ?
              AND pcu.project_id = ?`
        )
        .bind(scope.organizationId, scope.projectId)
        .all<Record<string, unknown>>();
      const grouped = new Map<string, PrivateChannelMembershipWithChannelRow[]>();
      for (const raw of results) {
        const row = mapMembershipWithChannelRow(raw);
        const bucket = grouped.get(row.private_channel_user_id) ?? [];
        bucket.push(row);
        grouped.set(row.private_channel_user_id, bucket);
      }
      return grouped;
    },

    async listMembershipsForUser(privateChannelUserId) {
      const { results = [] } = await db
        .prepare(
          `SELECT m.*,
                  c.name       AS channel_name,
                  c.is_default AS channel_is_default,
                  c.status     AS channel_status
             FROM private_channel_memberships m
             INNER JOIN private_channels c ON c.id = m.channel_id
            WHERE m.private_channel_user_id = ?`
        )
        .bind(privateChannelUserId)
        .all<Record<string, unknown>>();
      return results.map(mapMembershipWithChannelRow);
    },

    async addMembership(input: AddMembershipInput): Promise<PrivateChannelMembershipRow> {
      return db.transaction(async (tx) => {
        // Serializing on the channel makes concurrent first-member additions
        // choose exactly one owner instead of racing the partial unique index.
        await tx.queryOne("SELECT id FROM private_channels WHERE id = ? FOR UPDATE", [
          input.channelId,
        ]);
        const row = await tx
          .prepare(
            `INSERT INTO private_channel_memberships (
                 id, channel_id, private_channel_user_id, role, added_by
               ) VALUES (
                 ?, ?, ?,
                 CASE
                   WHEN EXISTS (
                     SELECT 1
                       FROM private_channel_memberships
                      WHERE channel_id = ?
                        AND role = ?
                   )
                   THEN ?
                   ELSE ?
                 END,
                 ?
               )
            -- No-op update so an existing membership can be RETURNED. Assigning
            -- excluded.role here would silently demote an owner and skip the
            -- last-manager guard and role-change event.
            ON CONFLICT (channel_id, private_channel_user_id) DO UPDATE
               SET added_at = private_channel_memberships.added_at
            RETURNING *`
          )
          .bind(
            generatePrivateChannelMembershipId(),
            input.channelId,
            input.privateChannelUserId,
            input.channelId,
            PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
            input.role,
            PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
            input.addedBy
          )
          .first<Record<string, unknown>>();
        if (!row) throw new Error("private_channel_memberships insert returned no row");
        return mapMembershipRow(row);
      });
    },

    async updateMembershipRole(channelId, privateChannelUserId, role) {
      return db.transaction(async (tx) => {
        await tx.queryOne("SELECT id FROM private_channels WHERE id = ? FOR UPDATE", [channelId]);
        const current = await tx.queryOne<{ role: PrivateChannelMembershipRole }>(
          `SELECT role
             FROM private_channel_memberships
            WHERE channel_id = ?
              AND private_channel_user_id = ?
              AND role <> ?`,
          [channelId, privateChannelUserId, PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER]
        );
        if (!current) return null;

        // Re-check under the channel lock: the caller's pre-flight count can go
        // stale when two managers step down at the same time.
        const demotesLastManager =
          current.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN &&
          role !== PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN;
        if (demotesLastManager && !(await hasOtherManager(tx, channelId, privateChannelUserId))) {
          return null;
        }

        const row = await tx.queryOne<Record<string, unknown>>(
          `UPDATE private_channel_memberships
              SET role = ?
            WHERE channel_id = ?
              AND private_channel_user_id = ?
          RETURNING *`,
          [role, channelId, privateChannelUserId]
        );
        return row
          ? {
              membership: mapMembershipRow(row),
              previousRole: current.role,
            }
          : null;
      });
    },

    async transferChannelOwnership(channelId, privateChannelUserId, currentOwnerId) {
      return db.transaction(async (tx) => {
        const channel = await tx.queryOne<{ id: string }>(
          "SELECT id FROM private_channels WHERE id = ? FOR UPDATE",
          [channelId]
        );
        if (!channel) return null;

        const previousOwner = await tx.queryOne<Record<string, unknown>>(
          `SELECT *
             FROM private_channel_memberships
            WHERE channel_id = ?
              AND role = ?`,
          [channelId, PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER]
        );
        const target = await tx.queryOne<Record<string, unknown>>(
          `SELECT *
             FROM private_channel_memberships
            WHERE channel_id = ?
              AND private_channel_user_id = ?`,
          [channelId, privateChannelUserId]
        );
        if (
          !previousOwner ||
          !target ||
          previousOwner.private_channel_user_id !== currentOwnerId ||
          previousOwner.id === target.id
        ) {
          return null;
        }

        const demoted = await tx.queryOne<Record<string, unknown>>(
          `UPDATE private_channel_memberships
              SET role = ?
            WHERE id = ?
          RETURNING *`,
          [PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN, previousOwner.id]
        );
        const owner = await tx.queryOne<Record<string, unknown>>(
          `UPDATE private_channel_memberships
              SET role = ?
            WHERE id = ?
          RETURNING *`,
          [PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER, target.id]
        );
        if (!demoted || !owner) {
          throw new Error("Ownership transfer did not update both memberships");
        }
        return {
          previousOwner: mapMembershipRow(demoted),
          owner: mapMembershipRow(owner),
          ownerPreviousRole: target.role as PrivateChannelMembershipRole,
        };
      });
    },

    async countChannelManagers(channelId) {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM private_channel_memberships
            WHERE channel_id = ?
              AND role IN (?, ?)`
        )
        .bind(
          channelId,
          PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
          PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN
        )
        .first<{ count: number | string }>();
      return Number(row?.count ?? 0);
    },

    async removeMembership(channelId, privateChannelUserId, channelArchived = false) {
      return db.transaction(async (tx) => {
        await tx.queryOne("SELECT id FROM private_channels WHERE id = ? FOR UPDATE", [channelId]);
        const membership = await tx.queryOne<{ role: PrivateChannelMembershipRole }>(
          `SELECT role
             FROM private_channel_memberships
            WHERE channel_id = ?
              AND private_channel_user_id = ?`,
          [channelId, privateChannelUserId]
        );
        if (!membership) return false;

        // Archiving releases both guards. On an active channel the owner stays and
        // one manager stays, re-checked here in case two step down at once.
        if (!channelArchived) {
          if (membership.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER) return false;
          if (
            membership.role === PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN &&
            !(await hasOtherManager(tx, channelId, privateChannelUserId))
          ) {
            return false;
          }
        }

        const row = await tx.queryOne<{ id: string }>(
          `DELETE FROM private_channel_memberships
            WHERE channel_id = ?
              AND private_channel_user_id = ?
          RETURNING id`,
          [channelId, privateChannelUserId]
        );
        return row !== null;
      });
    },
  };
}
