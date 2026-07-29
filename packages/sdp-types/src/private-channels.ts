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
  /** Base URL of the SPC auth service. Required — SPC's member/wallet model needs it. */
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
  auth: { reachable: boolean; error: string | null };
}

/** Soft-delete lifecycle for a channel. */
export const PRIVATE_CHANNEL_STATUSES = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;

export type PrivateChannelStatusDto =
  (typeof PRIVATE_CHANNEL_STATUSES)[keyof typeof PRIVATE_CHANNEL_STATUSES];

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
 * Transfer intent lifecycle, shared across deposits and withdrawals:
 *   pending    intent persisted, not yet broadcast
 *   submitted  on-chain broadcast succeeded, signature captured
 *   confirmed  tx confirmed on-chain (deposit: devnet; withdrawal: channel chain
 *              burn)
 *   settled    operator half done (withdrawal: release detected on devnet;
 *              deposit: reachable once SPC exposes events, unreachable under
 *              the current chain-heuristic oracle)
 *   failed     pre-broadcast or on-chain terminal failure. Never entered after
 *              `confirmed` for withdrawals — the balance is already gone.
 */
export type PrivateChannelTransferStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "settled"
  | "failed";

/**
 * Read-only audit snapshot of the SPC instance parameters at intent time.
 * Never consulted by the oracle — reconciliation reads the current instance row.
 * Secrets are redacted at render time.
 */
export interface PrivateChannelTransferContext {
  gatewayUrl?: string;
  chainRpcUrl?: string;
  escrowProgramId?: string;
  escrowInstanceAddr?: string;
  /** SDP user that created the intent. */
  actingUserId?: string;
  /** Oracle-internal debounce marker for the stuck-warning event. */
  lastStuckWarningAt?: string;
  [key: string]: unknown;
}

/**
 * A deposit intent: moves `amount` of `mint` from the `depositor` custody wallet
 * into the instance escrow on devnet, credited to `recipient` in the channel.
 * `amount` is a decimal string (never numeric/float).
 */
export interface PrivateChannelDeposit {
  id: string;
  instanceId: string;
  organizationId: string;
  projectId: string;
  /** Custody wallet the deposit is signed from. */
  walletId: string;
  /** Resolved depositor address (the custody wallet's public key). */
  depositor: string;
  /** Resolved recipient address credited in the channel (defaults to the depositor). */
  recipient: string;
  mint: string;
  amount: string;
  status: PrivateChannelTransferStatus;
  /** Devnet escrow transaction signature (null until submitted). */
  signature: string | null;
  /**
   * Settlement correlation. Populated when `status === "settled"`. Chain
   * oracle cannot reach this for deposits; set by the future SPC event source.
   */
  settlementRef: string | null;
  /** Set when `status === "failed"`. */
  failureReason: string | null;
  /** Audit snapshot; may have secrets redacted per caller permissions. */
  context: PrivateChannelTransferContext;
  createdAt: string;
  updatedAt: string;
}

/**
 * A withdrawal intent: burns `amount` of `mint` from the `owner`'s channel-chain
 * balance, then the operator releases the matching real USDC on devnet to
 * `destination`. `amount` is a decimal string (never numeric/float).
 */
export interface PrivateChannelWithdrawal {
  id: string;
  instanceId: string;
  organizationId: string;
  projectId: string;
  /** Custody wallet the withdrawal (burn) is signed from. */
  walletId: string;
  /** Channel-chain address whose token balance is burned. */
  owner: string;
  /** Devnet address that receives the operator's real-USDC release. */
  destination: string;
  mint: string;
  amount: string;
  status: PrivateChannelTransferStatus;
  /** Channel-chain burn signature (null until submitted). */
  signature: string | null;
  /**
   * Devnet release signature — the settlement correlation. Populated when
   * `status === "settled"`.
   */
  settlementRef: string | null;
  /** Set when `status === "failed"`. */
  failureReason: string | null;
  /** Audit snapshot; may have secrets redacted per caller permissions. */
  context: PrivateChannelTransferContext;
  createdAt: string;
  updatedAt: string;
}

/**
 * An owner's token balance on the channel, read through the gateway. Amounts are
 * strings to stay JSON- and precision-safe: `amount` is base units, `uiAmount` is
 * the human-readable value. A never-credited owner reads as a zero balance.
 *
 * Balances live at the SPC layer, one per (wallet, mint) — logical channels are
 * labels, so a wallet in multiple channels shows the SAME balance in each.
 */
export interface PrivateChannelBalance {
  /** Resolved owner address the balance is for. */
  owner: string;
  /** Token mint the balance is denominated in. */
  mint: string;
  /** The associated-token account probed on the channel (classic Token program). */
  tokenAccount: string;
  /** Raw base-unit amount. */
  amount: string;
  /** Mint decimals. */
  decimals: number;
  /** Human-readable amount. */
  uiAmount: string;
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

export const PRIVATE_CHANNEL_MEMBERSHIP_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
} as const;

export type PrivateChannelMembershipRole =
  (typeof PRIVATE_CHANNEL_MEMBERSHIP_ROLES)[keyof typeof PRIVATE_CHANNEL_MEMBERSHIP_ROLES];

export const PRIVATE_CHANNEL_MEMBERSHIP_ROLE_VALUES = [
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES.VIEWER,
] as const satisfies readonly PrivateChannelMembershipRole[];

export type PrivateChannelAssignableRole = Exclude<
  PrivateChannelMembershipRole,
  typeof PRIVATE_CHANNEL_MEMBERSHIP_ROLES.OWNER
>;

export const PRIVATE_CHANNEL_ASSIGNABLE_ROLE_VALUES = [
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES.VIEWER,
] as const satisfies readonly PrivateChannelAssignableRole[];

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
  status: PrivateChannelStatusDto;
  role: PrivateChannelMembershipRole;
}

export interface PrivateChannelMembershipDto {
  id: string;
  channelId: string;
  privateChannelUserId: string;
  role: PrivateChannelMembershipRole;
  addedBy: string | null;
  addedAt: string;
}

/** Invite an existing SDP project user to the SPC workspace. */
export interface InvitePrivateChannelUserRequest {
  userId: string;
}

/** Request body for adding a user to a channel. */
export interface AddPrivateChannelMembershipRequest {
  privateChannelUserId: string;
  role?: PrivateChannelAssignableRole;
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
  // Lifecycle — one per state transition, per kind. Emitted by the poll
  // handler after a CAS-successful advance.
  TRANSFER_DEPOSIT_SUBMITTED: "transfer.deposit.submitted",
  TRANSFER_DEPOSIT_CONFIRMED: "transfer.deposit.confirmed",
  TRANSFER_DEPOSIT_SETTLED: "transfer.deposit.settled",
  TRANSFER_DEPOSIT_FAILED: "transfer.deposit.failed",
  TRANSFER_WITHDRAWAL_SUBMITTED: "transfer.withdrawal.submitted",
  TRANSFER_WITHDRAWAL_CONFIRMED: "transfer.withdrawal.confirmed",
  TRANSFER_WITHDRAWAL_SETTLED: "transfer.withdrawal.settled",
  TRANSFER_WITHDRAWAL_FAILED: "transfer.withdrawal.failed",
  // Diagnostic — actionable operator signals. Never affect the intent state
  // machine; emitted opportunistically by the oracle during a poll and
  // debounced via context.lastStuckWarningAt.
  TRANSFER_DEPOSIT_AWAITING_SPC_CREDIT: "transfer.deposit.awaiting_spc_credit",
  TRANSFER_WITHDRAWAL_RELEASE_ATTEMPT_FAILED: "transfer.withdrawal.release_attempt_failed",
  TRANSFER_STUCK_WARNING: "transfer.stuck_warning",
  TRANSFER_NEEDS_MANUAL_REVIEW: "transfer.needs_manual_review",
  ERROR_SPC_UNREACHABLE: "error.spc_unreachable",
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
