/**
 * Solana Private Channels (SPC) — cross-package wire DTOs.
 *
 * The shapes exchanged between the sdp-api `/v1/private-channels/*` routes and
 * sdp-web. Pubkeys are strings and amounts are strings (base units, or decimal
 * for requests) so the DTOs stay JSON-safe. Engine-internal types (bigint,
 * @solana/kit brands) live in `@sdp/spc`.
 */

/** Per-instance RBAC fact. */
export type PrivateChannelAuthMode = "on" | "off";

/** The indexer `transactions` 8-state settlement machine. */
export const PRIVATE_CHANNEL_TX_STATUSES = [
  "pending",
  "processing",
  "completed",
  "parked",
  "failed",
  "failed_reminted",
  "manual_review",
  "pending_remint",
] as const;
/** One of the 8 indexer settlement states. */
export type PrivateChannelTxStatus = (typeof PRIVATE_CHANNEL_TX_STATUSES)[number];

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

/** A resolved channel balance for one `(wallet, mint)` pair. */
export interface PrivateChannelBalance {
  /** Owner wallet the balance belongs to. */
  wallet: string;
  /** Token mint the balance is denominated in. */
  mint: string;
  /** SPL program that owns the mint (classic SPL Token or Token-2022). */
  tokenProgram: string;
  /** Derived associated token account. */
  ata: string;
  /** Base-unit balance as a string. */
  amount: string;
  /** Human-readable amount. */
  uiAmount: string;
  /** Mint decimals. */
  decimals: number;
  /** False when the ATA does not exist on the channel yet. */
  exists: boolean;
}

/** Internal channel transfer request (custody-signed server-side). */
export interface PrivateChannelTransferRequest {
  /** Source SDP-managed custody wallet (id or pubkey). */
  from: string;
  /** Destination channel wallet address. */
  to: string;
  /** Token mint to transfer. */
  mint: string;
  /** Decimal amount (e.g. "1.5"); the API converts to base units. */
  amount: string;
}

/** Commitment reported for a submitted channel transaction. */
export type PrivateChannelConfirmationStatus = "processed" | "confirmed" | "finalized";

/** Result of a money-moving channel operation. */
export interface PrivateChannelTransferResult {
  /** The channel transaction signature. */
  signature: string;
  /** Confirmation slot as a string. */
  slot: string;
  /** Commitment reached for the transaction. */
  confirmationStatus: PrivateChannelConfirmationStatus;
}

/** Deposit request (L1 → channel). */
export interface PrivateChannelDepositRequest {
  /** Depositing wallet (id or pubkey). */
  wallet: string;
  /** Token mint to deposit. */
  mint: string;
  /** Decimal amount; the API converts to base units. */
  amount: string;
  /**
   * Optional credited wallet recorded for tracking; defaults to `wallet`. Does
   * not change the transfer (see `@sdp/spc` `DepositParams.recipient`).
   */
  recipient?: string;
}

/** Withdrawal request (channel → L1). */
export interface PrivateChannelWithdrawalRequest {
  /** Withdrawing wallet (id or pubkey). */
  wallet: string;
  /** Token mint to withdraw (burned on the channel). */
  mint: string;
  /** Decimal amount; the API converts to base units. */
  amount: string;
  /**
   * Advisory-only L1 recipient hint; defaults to `wallet`. The real release
   * target is set operator-side (see `@sdp/spc` `WithdrawParams.destination`).
   */
  destination?: string;
}
