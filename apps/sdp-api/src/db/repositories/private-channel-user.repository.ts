// Owns two tables:
//   - `private_channel_users`        (workspace-level invite + SPC credential)
//   - `private_channel_memberships`  (channel × user junction)
// Rows FK to `users(id)`; SDP-native user identity stays in the `users` table.

import type {
  PrivateChannelAssignableRole,
  PrivateChannelMembershipRole,
  PrivateChannelStatusDto,
} from "@sdp/types";
import type { RepositoryDbClient } from "./base";

export function generatePrivateChannelUserId(): string {
  return `pcu_${crypto.randomUUID()}`;
}

export function generatePrivateChannelMembershipId(): string {
  return `pcm_${crypto.randomUUID()}`;
}

export interface PrivateChannelUserRow {
  id: string;
  organization_id: string;
  project_id: string;
  user_id: string;
  spc_user_id: string | null;
  spc_username: string | null;
  spc_credential_ciphertext: string | null;
  invited_by: string | null;
  invite_token: string | null;
  invited_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row + joined columns from `users` (denormalized display fields) + verified-wallet count. */
export interface PrivateChannelUserWithIdentityRow extends PrivateChannelUserRow {
  user_email: string;
  user_name: string | null;
  /** Number of wallets this member has verified (from private_channel_verified_wallets). */
  verified_wallet_count: number;
}

export interface PrivateChannelMembershipRow {
  id: string;
  channel_id: string;
  private_channel_user_id: string;
  role: PrivateChannelMembershipRole;
  added_by: string | null;
  added_at: string;
}

/** Channel joined onto a membership row for display. */
export interface PrivateChannelMembershipWithChannelRow extends PrivateChannelMembershipRow {
  channel_name: string;
  channel_is_default: boolean;
  channel_status: PrivateChannelStatusDto;
}

export interface ProjectScope {
  organizationId: string;
  projectId: string;
}

export interface CreatePrivateChannelUserInput extends ProjectScope {
  userId: string;
  spcUserId: string;
  spcUsername: string;
  spcCredentialCiphertext: string;
  invitedBy: string | null;
  inviteToken: string | null;
}

export interface AddMembershipInput {
  channelId: string;
  privateChannelUserId: string;
  addedBy: string | null;
  /** Owner is never assignable here — the first member is promoted automatically. */
  role: PrivateChannelAssignableRole;
}

export interface TransferChannelOwnershipResult {
  previousOwner: PrivateChannelMembershipRow;
  owner: PrivateChannelMembershipRow;
  ownerPreviousRole: PrivateChannelMembershipRole;
}

export interface UpdateMembershipRoleResult {
  membership: PrivateChannelMembershipRow;
  previousRole: PrivateChannelMembershipRole;
}

export interface PrivateChannelUserRepositoryContext {
  db: RepositoryDbClient;
}

export interface PrivateChannelUserRepository {
  /** Project-scoped list, joined with `users` for display fields. */
  listByProject(scope: ProjectScope): Promise<PrivateChannelUserWithIdentityRow[]>;

  /** Single row, joined with `users`. Null when not found or not in scope. */
  getById(scope: ProjectScope, id: string): Promise<PrivateChannelUserWithIdentityRow | null>;

  /** Duplicate-invite check before hitting SPC /register. */
  findByProjectAndUser(scope: ProjectScope, userId: string): Promise<PrivateChannelUserRow | null>;

  /** Same as findByProjectAndUser but joined with `users` for display. */
  getByProjectAndUser(
    scope: ProjectScope,
    userId: string
  ): Promise<PrivateChannelUserWithIdentityRow | null>;

  /** Insert only after SPC /register succeeds (invite atomicity). */
  create(input: CreatePrivateChannelUserInput): Promise<PrivateChannelUserWithIdentityRow>;

  /** Hard-delete. FK cascade removes channel memberships. */
  deleteById(scope: ProjectScope, id: string): Promise<boolean>;

  /** All channel memberships for a project's users, keyed by user id (for list join). */
  listMembershipsByProject(
    scope: ProjectScope
  ): Promise<Map<string, PrivateChannelMembershipWithChannelRow[]>>;

  /** Channel memberships for a single user. */
  listMembershipsForUser(
    privateChannelUserId: string
  ): Promise<PrivateChannelMembershipWithChannelRow[]>;

  /**
   * Insert-if-not-exists. Returns the row (existing or newly created); an existing
   * row keeps its role — role changes go through updateMembershipRole or
   * transferChannelOwnership so their guards and events always run.
   */
  addMembership(input: AddMembershipInput): Promise<PrivateChannelMembershipRow>;

  /**
   * Change an existing channel membership's role. Returns null when the membership
   * is missing, is the owner, or is the channel's last manager being demoted.
   */
  updateMembershipRole(
    channelId: string,
    privateChannelUserId: string,
    role: PrivateChannelMembershipRole
  ): Promise<UpdateMembershipRoleResult | null>;

  /** Atomically transfer ownership and demote the previous owner to admin. */
  transferChannelOwnership(
    channelId: string,
    privateChannelUserId: string,
    currentOwnerId: string
  ): Promise<TransferChannelOwnershipResult | null>;

  /** Count owner/admin memberships assigned to a channel. */
  countChannelManagers(channelId: string): Promise<number>;

  /**
   * Remove a user from a channel. On an active channel the owner is never removed
   * and the last manager is kept; archiving lifts both.
   */
  removeMembership(
    channelId: string,
    privateChannelUserId: string,
    channelArchived?: boolean
  ): Promise<boolean>;
}
