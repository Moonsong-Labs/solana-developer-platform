import { solanaAddressSchema, z } from "./base";

export const privateChannelInstanceSchema = z
  .object({
    id: z.string().openapi({ example: "pci_01HXYZ" }),
    organizationId: z.string(),
    projectId: z.string(),
    gatewayUrl: z.string().openapi({ example: "http://34.71.147.163:8899" }),
    chainRpcUrl: z.string().openapi({ example: "https://devnet.helius-rpc.com/?api-key=…" }),
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
    confirmReactivate: z.boolean().optional().openapi({
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

export const privateChannelProbeBodySchema = z
  .object({
    gatewayUrl: z.string().min(1),
    chainRpcUrl: z.string().min(1),
  })
  .openapi({ description: "Probe request body: the two URLs the connect flow re-probes." });

const gatewayProbeResponseSchema = z.object({
  status: z.number(),
  ok: z.boolean(),
  body: z.unknown().optional(),
});

export const privateChannelOverviewSchema = z
  .object({
    gateway: z.object({
      health: z.discriminatedUnion("status", [
        z.object({ status: z.literal("ready"), latencyMs: z.number() }),
        z.object({ status: z.literal("degraded"), latencyMs: z.number(), reason: z.string() }),
        z.object({ status: z.literal("unreachable"), latencyMs: z.number(), error: z.string() }),
      ]),
      channelSlot: z.number().nullable(),
      latestBlockhash: z.string().nullable(),
    }),
    chainRpc: z.union([
      z.object({ ok: z.literal(true), solanaVersion: z.string().nullable() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    escrowInstance: z.union([
      z.object({
        present: z.literal(true),
        owner: z.string(),
        ownerMatchesProgram: z.boolean(),
        lamports: z.number(),
      }),
      z.object({ present: z.literal(false), error: z.string() }),
    ]),
    escrowProgram: z.union([
      z.object({ present: z.literal(true), executable: z.boolean() }),
      z.object({ present: z.literal(false), error: z.string() }),
    ]),
    auth: z.object({ reachable: z.boolean(), error: z.string().nullable() }).nullable(),
  })
  .openapi({ description: "Post-connect instance overview." });

export const privateChannelProbeResultSchema = z
  .object({
    ok: z.boolean(),
    gateway: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ready"),
        latencyMs: z.number(),
        health: gatewayProbeResponseSchema,
        ready: gatewayProbeResponseSchema,
      }),
      z.object({
        status: z.literal("degraded"),
        latencyMs: z.number(),
        health: gatewayProbeResponseSchema,
        ready: gatewayProbeResponseSchema,
        reason: z.string(),
      }),
      z.object({
        status: z.literal("unreachable"),
        latencyMs: z.number(),
        error: z.string(),
        health: gatewayProbeResponseSchema.optional(),
        ready: gatewayProbeResponseSchema.optional(),
      }),
    ]),
    rpc: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), latencyMs: z.number(), version: z.string() }),
      z.object({ ok: z.literal(false), latencyMs: z.number(), error: z.string() }),
    ]),
  })
  .openapi({ description: "Full connect-time probe result (gateway + chain RPC)." });

export const privateChannelSchema = z
  .object({
    id: z.string().openapi({ example: "pch_9f1c..." }),
    name: z.string().openapi({ example: "Treasury" }),
    description: z.string().nullable().openapi({ example: "Ops payouts" }),
    isDefault: z.boolean().openapi({
      description: "The connected instance's auto-provisioned default channel.",
      example: false,
    }),
    status: z
      .enum(["active", "archived"])
      .openapi({ description: "Soft-delete lifecycle status.", example: "active" }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi({ description: "A logical channel." });

export const privateChannelListSchema = z.object({
  channels: z.array(privateChannelSchema),
});

export const createPrivateChannelBodySchema = z
  .object({
    name: z.string().min(1).max(64).openapi({ example: "Treasury" }),
    description: z.string().optional().openapi({ example: "Ops payouts" }),
  })
  .openapi({ description: "Create a named private channel." });

export const privateChannelIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: "id", in: "path" },
      description: "Private channel id.",
      example: "pch_9f1c...",
    }),
});

export const privateChannelVerifiedWalletSchema = z
  .object({
    id: z.string().openapi({ example: "pcvw_9f1c..." }),
    walletId: z
      .string()
      .openapi({ description: "SDP managed custody wallet id.", example: "wallet_123" }),
    pubkey: solanaAddressSchema,
    verifiedAt: z.string(),
  })
  .openapi({ description: "A custody wallet verified with the connected SPC instance." });

export const privateChannelVerifiedWalletListSchema = z.object({
  wallets: z.array(privateChannelVerifiedWalletSchema),
});
