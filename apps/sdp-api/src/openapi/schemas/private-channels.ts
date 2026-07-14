import { solanaAddressSchema, z } from "./base";

export const privateChannelInstanceSchema = z
  .object({
    id: z.string().openapi({ example: "pci_01HXYZ" }),
    organizationId: z.string(),
    projectId: z.string(),
    gatewayUrl: z.string().openapi({ example: "http://34.71.147.163:8899" }),
    chainRpcUrl: z
      .string()
      .openapi({ example: "https://devnet.helius-rpc.com/?api-key=…" }),
    escrowProgramId: solanaAddressSchema,
    withdrawProgramId: solanaAddressSchema,
    escrowInstanceAddr: solanaAddressSchema,
    useAuth: z.boolean().openapi({ description: "Whether the gateway enforces auth." }),
    authUrl: z.string().openapi({ description: "Empty when useAuth=false." }),
    isActive: z.boolean().openapi({ description: "True for the active instance." }),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi({ description: "Persisted Private Channels instance." });

export const privateChannelInstanceInputSchema = z
  .object({
    gatewayUrl: z.string(),
    chainRpcUrl: z.string(),
    escrowProgramId: solanaAddressSchema,
    withdrawProgramId: solanaAddressSchema,
    escrowInstanceAddr: solanaAddressSchema,
    useAuth: z.boolean(),
    authUrl: z.string(),
    confirmReactivate: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Required (true) to reactivate an inactive same-gateway row and overwrite its config.",
      }),
  })
  .openapi({ description: "Connect request body." });

export const privateChannelHealthSchema = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("ready"), latencyMs: z.number() }),
    z.object({ status: z.literal("degraded"), latencyMs: z.number(), reason: z.string() }),
    z.object({ status: z.literal("unreachable"), latencyMs: z.number(), error: z.string() }),
  ])
  .openapi({ description: "Candidate-gateway health probe result." });

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
