/**
 * SPC engine-internal types.
 *
 * The shapes the library works with internally (bigint, @solana/kit brands).
 * Cross-package WIRE DTOs (what the sdp-api routes and sdp-web consume) live in
 * `@sdp/types/private-channels`; the sdp-api service maps between them.
 */

import type { PrivateChannelAuthMode, PrivateChannelConfirmationStatus } from "@sdp/types";
import type { Address, Signature } from "@solana/kit";

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
  /** Auth service base URL (`:8903`), when the instance exposes it. */
  authBaseUrl?: string;
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

/** A single `(wallet, mint)` channel balance, resolved via the derived ATA. */
export interface PrivateChannelBalanceRaw {
  /** Owner wallet the balance belongs to. */
  wallet: Address;
  /** Token mint the balance is denominated in. */
  mint: Address;
  /** SPL program that owns the mint (classic SPL Token or Token-2022). */
  tokenProgram: Address;
  /** Derived associated token account. */
  ata: Address;
  /** Base-unit balance; `0n` when the ATA does not exist. */
  amount: bigint;
  /** Mint decimals used to render `uiAmount`. */
  decimals: number;
  /** Human-readable amount (`formatDecimalAmount`). */
  uiAmount: string;
  /** False when the ATA does not exist on the channel yet. */
  exists: boolean;
}

/** Result of submitting a money-moving transaction to the channel. */
export interface PrivateChannelTransferReceipt {
  /** The submitted transaction's signature. */
  signature: Signature;
  /** Slot the transaction was confirmed in. */
  slot: bigint;
  /** Commitment reached (the channel jumps straight to `finalized`). */
  confirmationStatus: PrivateChannelConfirmationStatus;
}
