import { z } from "zod";

/** Query params for `GET /health`. */
export const healthQuerySchema = z.object({
  /** Candidate SPC gateway base URL to probe. */
  gatewayUrl: z.string().min(1),
});

/** Query params for `GET /balances`. */
export const balancesQuerySchema = z.object({
  /** Managed wallet id or a Solana address. */
  wallet: z.string().min(1),
  /** Comma-separated mint addresses; defaults to the configured USDC mint. */
  mints: z.string().optional(),
});

/** Request body for `POST /transfers`. */
export const transferBodySchema = z.object({
  /** Source SDP-managed custody wallet (id or pubkey). */
  from: z.string().min(1),
  /** Destination channel address. */
  to: z.string().min(1),
  mint: z.string().min(1),
  /** Decimal amount, e.g. "1.5". */
  amount: z.string().min(1),
});

/** Parsed `POST /transfers` body. */
export type TransferBody = z.infer<typeof transferBodySchema>;
