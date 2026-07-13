/**
 * Solana Private Channels (SPC) — cross-package wire DTOs.
 *
 * The shapes exchanged between the sdp-api `/v1/private-channels/*` routes and
 * sdp-web. Pubkeys are strings and amounts are strings (base units, or decimal
 * for requests) so the DTOs stay JSON-safe. Engine-internal types (bigint,
 * @solana/kit brands) live in `@sdp/private-channels`.
 */

/** Per-instance RBAC fact: `"jwt"` = gateway enforces JWT-gated reads, `"none"` = open. */
export type PrivateChannelAuthMode = "none" | "jwt";

/**
 * Raw connection config a user enters in the dashboard "Connect" form (and the
 * `SANDBOX_DEFAULTS` that prefill it). Distinct from the resolved runtime config
 * in `@sdp/private-channels`; a form→runtime mapper + persistence land later.
 */
export interface PrivateChannelInstanceConfig {
  gatewayUrl: string;
  devnetRpcUrl: string;
  escrowProgramId: string;
  withdrawProgramId: string;
  escrowInstanceAddr: string;
  authMode: PrivateChannelAuthMode;
  authUrl: string;
}

/**
 * Public sandbox instance operated by the SPC upstream team (PROPOSAL.md §0).
 * All identifiers are on-chain public keys, not secrets.
 */
export const SANDBOX_DEFAULTS: PrivateChannelInstanceConfig = {
  gatewayUrl: "http://34.71.147.163:8899",
  devnetRpcUrl: "https://api.devnet.solana.com",
  // biome-ignore lint/security/noSecrets: Public Solana program ID.
  escrowProgramId: "9tgHa1DcnaSSUtmMsst8ovKTe1Gfxzezn27KnH9xXYeU",
  // biome-ignore lint/security/noSecrets: Public Solana program ID.
  withdrawProgramId: "J231K9UEpS4y4KAPwGc4gsMNCjKFRMYcQBcjVW7vBhVi",
  // biome-ignore lint/security/noSecrets: Public Solana account address.
  escrowInstanceAddr: "7C1Pu8mbHaDDTFnGH8YTqemNDofqXP3XEotzSo6TbwHz",
  authMode: "none",
  authUrl: "",
};

/** Connection + health snapshot for the connected SPC instance. */
export interface PrivateChannelInstanceInfo {
  /** JSON-RPC gateway base URL (`:8899`). */
  gatewayUrl: string;
  /** Whether the gateway enforces JWT-gated reads. */
  authMode: PrivateChannelAuthMode;
  /** L1 cluster the escrow legs settle on. */
  network: "devnet" | "mainnet-beta";
  /** `GET /health` returned 200. */
  healthy: boolean;
  /** `GET /ready` returned 200 (both upstream nodes reachable). */
  ready: boolean;
  /** Escrow program id (L1), when configured. */
  escrowProgramId?: string;
  /** Withdraw program id (channel), when configured. */
  withdrawProgramId?: string;
  /** Escrow instance address, when configured. */
  escrowInstance?: string;
  /** Canonical channel USDC mint, when configured. */
  usdcMint?: string;
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
