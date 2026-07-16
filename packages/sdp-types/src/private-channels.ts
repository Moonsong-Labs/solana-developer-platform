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
  chainRpc:
    | { ok: true; solanaVersion: string | null }
    | { ok: false; error: string };
  escrowInstance:
    | { present: true; owner: string; ownerMatchesProgram: boolean; lamports: number }
    | { present: false; error: string };
  escrowProgram:
    | { present: true; executable: boolean }
    | { present: false; error: string };
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
