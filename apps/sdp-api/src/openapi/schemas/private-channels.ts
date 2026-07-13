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
