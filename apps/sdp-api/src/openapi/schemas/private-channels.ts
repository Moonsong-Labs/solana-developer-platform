import { solanaAddressSchema, z } from "./base";

export const privateChannelInstanceSchema = z
  .object({
    gatewayUrl: z.string().openapi({ example: "http://34.71.147.163:8899" }),
    authMode: z
      .enum(["none", "jwt"])
      .openapi({ description: "Gateway RBAC mode.", example: "none" }),
    network: z.enum(["devnet", "mainnet-beta"]).openapi({ example: "devnet" }),
    healthy: z.boolean().openapi({ description: "GET /health returned 200.", example: true }),
    ready: z.boolean().openapi({ description: "GET /ready returned 200.", example: true }),
    escrowProgramId: solanaAddressSchema.optional(),
    withdrawProgramId: solanaAddressSchema.optional(),
    escrowInstance: solanaAddressSchema.optional(),
    usdcMint: solanaAddressSchema.optional(),
  })
  .openapi({ description: "Connected Private Channels instance connection + health snapshot." });

export const privateChannelBalanceSchema = z
  .object({
    wallet: solanaAddressSchema,
    mint: solanaAddressSchema,
    tokenProgram: solanaAddressSchema,
    ata: solanaAddressSchema,
    amount: z.string().openapi({ description: "Base-unit balance.", example: "1000000" }),
    uiAmount: z.string().openapi({ description: "Human-readable amount.", example: "1" }),
    decimals: z.number().int().nonnegative().openapi({ example: 6 }),
    exists: z
      .boolean()
      .openapi({ description: "Whether the ATA exists on the channel.", example: true }),
  })
  .openapi({ description: "A channel balance for one (wallet, mint)." });

export const privateChannelTransferRequestSchema = z
  .object({
    from: z
      .string()
      .min(1)
      .openapi({ description: "Source SDP-managed wallet id or pubkey.", example: "wal_example" }),
    to: solanaAddressSchema,
    mint: solanaAddressSchema,
    amount: z.string().min(1).openapi({ description: "Decimal amount.", example: "1.5" }),
  })
  .openapi({ description: "Internal channel transfer request (custody-signed)." });

export const privateChannelTransferResultSchema = z
  .object({
    signature: z.string().openapi({ description: "Channel transaction signature." }),
    slot: z.string().openapi({ description: "Confirmation slot.", example: "12345" }),
    confirmationStatus: z
      .enum(["processed", "confirmed", "finalized"])
      .openapi({ example: "finalized" }),
  })
  .openapi({ description: "Result of a channel transfer." });

export const privateChannelBalancesQuerySchema = z.object({
  wallet: z
    .string()
    .min(1)
    .openapi({
      param: { name: "wallet", in: "query" },
      description: "Managed wallet id or a Solana address.",
      example: "wal_example",
    }),
  mints: z
    .string()
    .optional()
    .openapi({
      param: { name: "mints", in: "query" },
      description: "Comma-separated mint addresses; defaults to the configured USDC mint.",
    }),
});

export const privateChannelHealthSchema = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("ready"), latencyMs: z.number() }),
    z.object({ status: z.literal("degraded"), latencyMs: z.number(), reason: z.string() }),
    z.object({ status: z.literal("unreachable"), latencyMs: z.number(), error: z.string() }),
  ])
  .openapi({ description: "Candidate-gateway health probe result (ready/degraded/unreachable)." });

export const privateChannelHealthQuerySchema = z.object({
  gatewayUrl: z
    .string()
    .min(1)
    .openapi({
      param: { name: "gatewayUrl", in: "query" },
      description: "Candidate SPC gateway base URL to probe.",
      example: "http://34.71.147.163:8899",
    }),
});
