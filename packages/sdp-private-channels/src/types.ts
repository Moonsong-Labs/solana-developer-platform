/**
 * SPC engine-internal types.
 *
 * The shapes the library works with internally (bigint, @solana/kit brands).
 * Cross-package WIRE DTOs (what the sdp-api routes and sdp-web consume) live in
 * `@sdp/types/private-channels`; the sdp-api service maps between them.
 */

import type { PrivateChannelAuthMode } from "@sdp/types";
import type { Address } from "@solana/kit";

/**
 * Per-instance RBAC fact: whether the gateway enforces JWT-gated reads.
 * `"jwt"` = RBAC enforced, `"none"` = open proxy. Single source: `@sdp/types`.
 */
export type AuthMode = PrivateChannelAuthMode;

/** L1 cluster the escrow deposit/withdraw legs settle on. */
export type PrivateChannelNetwork = "devnet" | "mainnet-beta";

/**
 * Resolved connection facts for one SPC instance. Built by `resolvePrivateChannelConfig`
 * from `PRIVATE_CHANNEL_*` env. Addresses are validated at resolve time.
 */
export interface PrivateChannelConfig {
  /** JSON-RPC gateway base URL (`:8899`). */
  gatewayUrl: string;
  /** Whether gateway RBAC is enabled for this instance. */
  authMode: AuthMode;
  /** Escrow program (L1). */
  escrowProgramId?: Address;
  /** Withdraw program (channel). */
  withdrawProgramId?: Address;
  /** Escrow instance address. */
  escrowInstance?: Address;
  /** Canonical channel USDC mint, when known. */
  usdcMint?: Address;
  /** L1 cluster the escrow legs settle on (from `SOLANA_NETWORK`). */
  network: PrivateChannelNetwork;
}

/** Result of a gateway REST liveness/readiness probe (`/health`, `/ready`). */
export interface GatewayHealth {
  /** True when the endpoint returned a 2xx. */
  ok: boolean;
  /** The HTTP status code (0 when the request never completed). */
  status: number;
}

