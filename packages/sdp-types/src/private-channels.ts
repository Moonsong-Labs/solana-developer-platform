// Private Channels: SDP-side connection metadata for a Solana Private Channels
// (SPC) instance. One record per project.

/** Per-instance RBAC fact: `"jwt"` = gateway enforces JWT-gated reads, `"none"` = open. */
export type PrivateChannelAuthMode = "none" | "jwt";

/**
 * User-editable connection fields. These populate the connect form and are
 * validated identically on the client and server via the zod schema in
 * `@sdp/private-channels/schema`.
 */
export interface PrivateChannelInstanceInput {
  gatewayUrl: string;
  chainRpcUrl: string;
  escrowProgramId: string;
  withdrawProgramId: string;
  escrowInstanceAddr: string;
  useAuth: boolean;
  authUrl: string;
}

/**
 * Persisted instance row projected to the API contract. `isActive` distinguishes
 * the currently-connected instance from historical rows the project has
 * disconnected from but not deleted. At most one active row per project.
 */
export interface PrivateChannelInstance extends PrivateChannelInstanceInput {
  id: string;
  organizationId: string;
  projectId: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrivateChannelInstanceResponse {
  instance: PrivateChannelInstance;
}

export interface PrivateChannelInstanceEnvelope {
  instance: PrivateChannelInstance | null;
}

/**
 * Result of probing a candidate gateway's `/health` + `/ready` (the connect
 * form's "Test connection"). JSON-safe; upstream response bodies are not
 * surfaced. Discriminated on `status`.
 */
export type PrivateChannelHealth =
  | { status: "ready"; latencyMs: number }
  | { status: "degraded"; latencyMs: number; reason: string }
  | { status: "unreachable"; latencyMs: number; error: string };

/**
 * Post-connect overview. Two data sources:
 *   - `gateway.*` — SPC channel chain via the gateway's JSON-RPC passthrough
 *   - `chainRpc.*` — Solana L1 via the direct chain RPC URL (where the escrow
 *     program and its instance actually live)
 * Every field independently nullable so a partial outage still renders.
 */
export interface PrivateChannelInstanceOverview {
  gateway: {
    health: PrivateChannelHealth;
    /** Channel chain slot (activity/freshness signal). */
    channelSlot: number | null;
    /** Channel chain latest blockhash. */
    latestBlockhash: string | null;
  };
  chainRpc: { ok: true; solanaVersion: string | null } | { ok: false; error: string };
  escrowInstance:
    | { present: true; owner: string; ownerMatchesProgram: boolean; lamports: number }
    | { present: false; error: string };
  escrowProgram: { present: true; executable: boolean } | { present: false; error: string };
  /** Null when `useAuth === false` — the auth service isn't in the deployment. */
  auth: { reachable: boolean; error: string | null } | null;
}

/** Soft-delete lifecycle for a channel. */
export type PrivateChannelStatusDto = "active" | "archived";

/** A logical channel. Exactly one channel per instance is the default (`isDefault`). */
export interface PrivateChannelDto {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  status: PrivateChannelStatusDto;
  createdAt: string;
  updatedAt: string;
}

/** Request body for creating a channel (`POST /v1/private-channels/channels`). */
export interface CreatePrivateChannelRequest {
  name: string;
  description?: string;
}

/**
 * A custody wallet that has completed the SPC challenge → verify handshake for
 * the project's connected instance. Returned by the verify + list endpoints.
 */
export interface PrivateChannelVerifiedWalletDto {
  id: string;
  /** SDP managed custody wallet id (the `walletId` from GET /v1/wallets). */
  walletId: string;
  /** The verified Solana pubkey (base58). */
  pubkey: string;
  verifiedAt: string;
}

/** An SDP user invited to the SPC workspace, joined with `users` for display. */
export interface PrivateChannelUserDto {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  /** How many wallets this member has verified with the connected instance. */
  verifiedWalletCount: number;
  invitedAt: string;
  /** Channels this user is a member of. */
  channels: PrivateChannelMembershipChannelDto[];
}

export interface PrivateChannelMembershipChannelDto {
  id: string;
  name: string;
  isDefault: boolean;
}

/** Invite an existing SDP project user to the SPC workspace. */
export interface InvitePrivateChannelUserRequest {
  userId: string;
}

/** Request body for adding a user to a channel. */
export interface AddPrivateChannelMembershipRequest {
  privateChannelUserId: string;
}

// --- Private Channel Events ---------------------------------------------

/** Known event family strings. Prefer these over raw string literals. */
export const PRIVATE_CHANNEL_EVENT_FAMILIES = {
  MEMBER: "member",
  TRANSFER: "transfer",
  ERROR: "error",
  LIFECYCLE: "lifecycle",
} as const;

export type PrivateChannelEventFamily =
  (typeof PRIVATE_CHANNEL_EVENT_FAMILIES)[keyof typeof PRIVATE_CHANNEL_EVENT_FAMILIES];

/** Tuple of all families — for Zod enums and exhaustive lists. */
export const PRIVATE_CHANNEL_EVENT_FAMILY_VALUES = [
  PRIVATE_CHANNEL_EVENT_FAMILIES.MEMBER,
  PRIVATE_CHANNEL_EVENT_FAMILIES.TRANSFER,
  PRIVATE_CHANNEL_EVENT_FAMILIES.ERROR,
  PRIVATE_CHANNEL_EVENT_FAMILIES.LIFECYCLE,
] as const satisfies readonly PrivateChannelEventFamily[];

/** Known event status strings. Prefer these over raw string literals. */
export const PRIVATE_CHANNEL_EVENT_STATUSES = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  STALE: "stale",
  INFO: "info",
} as const;

export type PrivateChannelEventStatus =
  (typeof PRIVATE_CHANNEL_EVENT_STATUSES)[keyof typeof PRIVATE_CHANNEL_EVENT_STATUSES];

/** Tuple of all statuses — for Zod enums and exhaustive lists. */
export const PRIVATE_CHANNEL_EVENT_STATUS_VALUES = [
  PRIVATE_CHANNEL_EVENT_STATUSES.PENDING,
  PRIVATE_CHANNEL_EVENT_STATUSES.CONFIRMED,
  PRIVATE_CHANNEL_EVENT_STATUSES.FAILED,
  PRIVATE_CHANNEL_EVENT_STATUSES.STALE,
  PRIVATE_CHANNEL_EVENT_STATUSES.INFO,
] as const satisfies readonly PrivateChannelEventStatus[];

/** Known event type strings used by producers. Prefer these over raw string literals. */
export const PRIVATE_CHANNEL_EVENT_TYPES = {
  LIFECYCLE_INSTANCE_CONNECTED: "lifecycle.instance.connected",
  LIFECYCLE_INSTANCE_DISCONNECTED: "lifecycle.instance.disconnected",
  LIFECYCLE_CHANNEL_CREATED: "lifecycle.channel.created",
  LIFECYCLE_CHANNEL_ARCHIVED: "lifecycle.channel.archived",
  MEMBER_ADDED: "member.added",
  MEMBER_REVOKED: "member.revoked",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  MEMBER_WALLET_CHALLENGE_REQUESTED: "member.wallet_challenge_requested",
  MEMBER_WALLET_VERIFIED: "member.wallet_verified",
  MEMBER_WALLET_VERIFICATION_REVOKED: "member.wallet_verification_revoked",
  TRANSFER_DEPOSIT_SUBMITTED: "transfer.deposit.submitted",
  TRANSFER_DEPOSIT_CREDITED: "transfer.deposit.credited",
  TRANSFER_TRANSFER_SUBMITTED: "transfer.transfer.submitted",
  TRANSFER_TRANSFER_CONFIRMED: "transfer.transfer.confirmed",
  TRANSFER_WITHDRAWAL_SUBMITTED: "transfer.withdrawal.submitted",
  TRANSFER_WITHDRAWAL_RELEASED: "transfer.withdrawal.released",
  ERROR_SPC_UNREACHABLE: "error.spc_unreachable",
  ERROR_INTENT_SUBMIT_REJECTED: "error.intent.submit_rejected",
  ERROR_JWT_REFRESH_FAILED: "error.jwt_refresh_failed",
  ERROR_RECONCILIATION_MISMATCH: "error.reconciliation_mismatch",
} as const;

export type PrivateChannelEventType =
  (typeof PRIVATE_CHANNEL_EVENT_TYPES)[keyof typeof PRIVATE_CHANNEL_EVENT_TYPES];

/** Tuple of all known types — for Zod enums and exhaustive lists. */
export const PRIVATE_CHANNEL_EVENT_TYPE_VALUES = Object.values(PRIVATE_CHANNEL_EVENT_TYPES) as [
  PrivateChannelEventType,
  ...PrivateChannelEventType[],
];

export interface PrivateChannelEventDto {
  id: string;
  organizationId: string;
  projectId: string;
  instanceId: string;
  channelId: string | null;
  sdpUserId: string | null;
  family: PrivateChannelEventFamily;
  type: PrivateChannelEventType;
  status: PrivateChannelEventStatus;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface PrivateChannelEventListEnvelope {
  events: PrivateChannelEventDto[];
  hasMore: boolean;
  /** Opaque cursor for the next page; null when there are no more events. */
  nextCursor: string | null;
}
