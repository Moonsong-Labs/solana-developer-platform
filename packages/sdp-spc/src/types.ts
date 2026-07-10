/**
 * SPC engine-internal types.
 *
 * These are the shapes the library works with internally. Cross-package WIRE
 * DTOs (what the sdp-api routes and sdp-web consume) live in
 * `@sdp/types/private-channels`; the sdp-api service maps between them.
 */

import type { Address, Signature } from "@solana/kit";

/** Per-instance RBAC fact: whether the gateway enforces JWT-gated reads. */
export type SpcAuthMode = "on" | "off";

/** L1 cluster the escrow deposit/withdraw legs settle on. */
export type SpcNetwork = "devnet" | "mainnet-beta";

/**
 * Resolved connection facts for one SPC instance. Built by `resolveSpcConfig`
 * from `PRIVATE_CHANNEL_*` env. Addresses are validated at resolve time.
 */
export interface SpcInstanceConfig {
  /** JSON-RPC gateway base URL (`:8899`). */
  gatewayUrl: string;
  /** Auth service base URL (`:8903`), when the instance exposes it. */
  authBaseUrl?: string;
  /** Whether gateway RBAC is enabled for this instance. */
  authMode: SpcAuthMode;
  /** Devnet/mainnet L1 RPC for escrow deposit/withdraw legs (not the gateway). */
  l1RpcUrl?: string;
  /** Escrow program (L1). */
  escrowProgramId?: Address;
  /** Withdraw program (channel). */
  withdrawProgramId?: Address;
  /** Escrow instance address. */
  escrowInstance?: Address;
  /** Canonical channel USDC mint, when known. */
  usdcMint?: Address;
  /** L1 cluster the escrow legs settle on (from `SOLANA_NETWORK`). */
  network: SpcNetwork;
}

/** Result of a gateway REST liveness/readiness probe (`/health`, `/ready`). */
export interface GatewayHealth {
  /** True when the endpoint returned a 2xx. */
  ok: boolean;
  /** The HTTP status code (0 when the request never completed). */
  status: number;
}

/** A single `(wallet, mint)` channel balance, resolved via the derived ATA. */
export interface SpcBalance {
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

/** An unsigned wire transaction ready for a client wallet to sign. */
export interface PreparedTransaction {
  /** Base64 unsigned wire transaction. */
  transactionBase64: string;
  /** Recent blockhash the transaction's lifetime is anchored to. */
  blockhash: string;
  /** Last slot at which `blockhash` remains valid. */
  lastValidBlockHeight: bigint;
}

/** A prepared internal transfer, for the future client-signed path. */
export interface PreparedInternalTransfer extends PreparedTransaction {
  /** Source owner's associated token account (debited). */
  fromAta: Address;
  /** Destination owner's associated token account (credited). */
  toAta: Address;
}

/** Commitment reported for a submitted transaction (matches @solana/kit `Commitment`). */
export type SpcConfirmationStatus = "processed" | "confirmed" | "finalized";

/** Result of submitting a money-moving transaction to the channel. */
export interface SpcTransferReceipt {
  /** The submitted transaction's signature. */
  signature: Signature;
  /** Slot the transaction was confirmed in. */
  slot: bigint;
  /** Commitment reached (the channel jumps straight to `finalized`). */
  confirmationStatus: SpcConfirmationStatus;
}

// ── Auth service DTOs (typed; client in auth.ts) ────────────────────────────

/** A registered SPC auth user (`POST /auth/register`, `password_hash` omitted). */
export interface SpcAuthUser {
  /** User UUID; the JWT `sub`. */
  id: string;
  /** 5–32 chars, alphanumeric + `_`/`-`, globally unique. */
  username: string;
  /** Global role; `user` on register, `operator` only via the auth-admin CLI. */
  role: "user" | "operator";
  /** ISO-8601 creation timestamp. */
  created_at: string;
}

/** A login result (`POST /auth/login`). */
export interface SpcAuthToken {
  /** HS256 JWT, 24h, no refresh — re-login to renew. */
  token: string;
}

/** A wallet-verification challenge (`POST /auth/challenge-wallet`). */
export interface SpcWalletChallenge {
  /** The exact message the wallet must Ed25519-sign (server-authored). */
  message: string;
  /** Single-use nonce echoed back on verify. */
  nonce: string;
  /** ISO-8601 expiry (10-min TTL). */
  expires_at: string;
}

/** A verified wallet row (`POST /auth/verify-wallet`, `GET /auth/wallets`). */
export interface SpcVerifiedWallet {
  /** Base58 wallet pubkey. */
  pubkey: string;
  /** ISO-8601 verification timestamp. */
  created_at: string;
}

// ── Program pathway params (typed; builders not implemented yet) ────────────

/** Inputs for the escrow `Deposit` (L1 → channel) instruction builder. */
export interface DepositParams {
  /** Transaction fee payer (signs). */
  payer: Address;
  /** Depositing user; the SPL transfer authority (signs). */
  user: Address;
  /** Escrow Instance PDA (already derived). */
  instance: Address;
  /** Mint being deposited. */
  mint: Address;
  /** Amount in base units. */
  amount: bigint;
  /**
   * Optional credited wallet (a wallet address, NOT an ATA) recorded on the
   * escrow `DepositEvent` for channel-side tracking; defaults to `user` when
   * omitted. It does NOT change the token transfer, which always moves
   * user_ata → instance_ata.
   */
  recipient?: Address;
}

/** Inputs for the withdraw `WithdrawFunds` (channel → L1) instruction builder. */
export interface WithdrawParams {
  /** Withdrawing user; the burn authority (signs). */
  user: Address;
  /** Mint being withdrawn (burned). */
  mint: Address;
  /** Amount in base units. */
  amount: bigint;
  /**
   * Advisory-only: recorded on the `WithdrawFundsEvent` (defaults to `user`).
   * The burn ignores it and moves no funds — the real L1 release recipient is
   * chosen operator-side via the escrow `ReleaseFunds.user` arg.
   */
  destination?: Address;
}

// ── Reconciliation (typed; see reconcile.ts) ────────────────────────────────

/** The indexer `transactions` 8-state machine (DB/wire values are lowercase). */
export type SpcTxStatus =
  | "pending"
  | "processing"
  | "completed"
  | "parked"
  | "failed"
  | "failed_reminted"
  | "manual_review"
  | "pending_remint";

/**
 * The subset of the indexer `transactions` row the reconciler reads, keyed by
 * the real composite key `(signature, instruction_index, inner_index)`. Field
 * names mirror the Postgres columns (snake_case) so a `SELECT` maps 1:1 — the
 * full table has ~24 columns (memo, withdrawal_nonce, remint_*, finality_*,
 * created_at/updated_at); this is the reconciler projection, not the whole row.
 *
 * Note: there is NO `timestamp` column and NO error/reason column — failure text
 * rides the failure webhook only (`SpcFailureWebhookPayload`). `amount`
 * (NUMERIC) and `slot` (BIGINT) come back from the pg driver as strings; convert
 * at the boundary.
 */
export interface IndexerTransactionRow {
  /** On-chain signature of this leg. */
  signature: string;
  /** Instruction ordinal within the tx; part of the key. NOT NULL, defaults to 0. */
  instruction_index: number;
  /** Inner-instruction ordinal; part of the key. Nullable. */
  inner_index: number | null;
  /** Cross-leg correlation id (deposit ↔ mint, withdraw ↔ release). */
  trace_id: string;
  /** Current settlement state. */
  status: SpcTxStatus;
  /** Leg discriminator (streamer remaps `withdrawal` → `withdraw` on the wire). */
  transaction_type: "deposit" | "withdrawal";
  /** The settled counterpart-leg signature; null until completion. */
  counterpart_signature: string | null;
  /** Slot as a string (BIGINT from the pg driver). */
  slot: string;
  /** Initiating wallet. */
  initiator: string;
  /** Crediting wallet. */
  recipient: string;
  /** Token mint. */
  mint: string;
  /** Base-unit amount as a string (NUMERIC from the pg driver). */
  amount: string;
  /** ISO-8601 completion timestamp; null until processed. */
  processed_at: string | null;
}

/**
 * The failure webhook payload SPC POSTs to `ALERT_WEBHOOK_URL` on
 * `failed` / `failed_reminted` / `manual_review` (plain JSON, no HMAC header).
 * Keys are the literal snake_case fields the operator emits.
 */
export interface SpcFailureWebhookPayload {
  /** The indexer row's numeric primary key. */
  transaction_id: number;
  /** Cross-leg correlation id; null when unset. */
  trace_id: string | null;
  /** The failure state that triggered the webhook. */
  status: "failed" | "failed_reminted" | "manual_review";
  /** Counterpart-leg signature, when known. */
  counterpart_signature: string | null;
  /** Human-readable failure reason (lives only here, never in the DB). */
  error_message: string | null;
  /** RFC3339 processing timestamp. */
  processed_at: string;
  /** RFC3339 emit timestamp. */
  timestamp: string;
  /** Remint attempt signature, when one was made. */
  remint_signature: string | null;
  /** Remint outcome: `success` if signed, `failed` if attempted, else null. */
  remint_status: "success" | "failed" | null;
}

// ── Streamer (typed; see streamer.ts) ───────────────────────────────────────

/**
 * One `/ws` firehose frame. ⚠️ Emitted once at insert (usually `pending`); the
 * streamer does NOT re-broadcast the settlement transition — do not use it to
 * decide "did it settle" (use reconciliation instead).
 *
 * Value domains (kept as `string` since SPC may add types):
 * - `type` ∈ deposit | withdraw | transfer | mint_to | burn | create_instance |
 *   allow_mint | block_mint | add_operator | remove_operator | set_admin |
 *   release | reset_smt | unknown. (The indexer's `transaction_type="withdrawal"`
 *   is remapped to `type="withdraw"` here.)
 * - `status` ∈ the 8 `SpcTxStatus` values, plus a streamer-only `confirmed`.
 */
export interface StreamerEvent {
  /** On-chain signature of the tx this frame reports. */
  signature: string;
  /** Always `private_channel`. */
  chain: "private_channel";
  /** Event/instruction kind (see the `type` domain above). */
  type: string;
  /** Source wallet/account. */
  from: string;
  /** Destination wallet/account. */
  to: string;
  /** Base-unit amount as a decimal string, or null when not applicable. */
  amount: string | null;
  /** Token mint, or null when not applicable. */
  mint: string | null;
  /** Unix-seconds timestamp (synthesized from `created_at`). */
  timestamp: number;
  /** Settlement/emit status (see the `status` domain above). */
  status: string;
  /** Slot the tx landed in. */
  slot: number;
}
