import { privateChannelInstanceInputSchema } from "@sdp/private-channels";
import { z } from "zod";

// `confirmReactivate` is a client acknowledgement that we're about to overwrite
// config on an existing (inactive) row that downstream data may be bound to.
export const connectPrivateChannelInstanceSchema = z.intersection(
  privateChannelInstanceInputSchema,
  z.object({ confirmReactivate: z.boolean().optional() })
);

export type ConnectPrivateChannelInstanceInput = z.infer<
  typeof connectPrivateChannelInstanceSchema
>;

/** Body for `POST /probe`: the two URLs the connect flow re-probes. */
export const probeConnectionSchema = z.object({
  gatewayUrl: z.string().min(1),
  chainRpcUrl: z.string().min(1),
});

/** Query params for `GET /health`. */
export const healthQuerySchema = z.object({
  gatewayUrl: z.string().min(1),
});

/** Request body for `POST /channels`. Name content is validated in the domain layer. */
export const createChannelBodySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

/**
 * Query params for `GET /balance`: `owner` (a `walletId` from GET /v1/wallets, a
 * wallet public key, or a raw Solana address) and an optional `mint` (defaults to
 * the instance cluster's USDC mint).
 */
export const balanceQuerySchema = z.object({
  owner: z.string().min(1),
  mint: z.string().min(1).optional(),
});

/**
 * Body for `POST /deposits`. `walletId` is the source custody wallet (a `walletId`
 * from GET /v1/wallets or its public key); `amount` is a decimal string; optional
 * `recipient` (walletId or address) is credited in the channel, defaulting to the
 * depositor.
 */
export const createDepositBodySchema = z.object({
  walletId: z.string().min(1),
  amount: z.string().min(1),
  recipient: z.string().min(1).optional(),
});

/** Path param for `GET /deposits/:id`. */
export const depositIdParamSchema = z.object({
  id: z.string().min(1),
});
