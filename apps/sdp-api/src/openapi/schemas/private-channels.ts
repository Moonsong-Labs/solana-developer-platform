import {
  PRIVATE_CHANNEL_EVENT_FAMILY_VALUES,
  PRIVATE_CHANNEL_EVENT_STATUS_VALUES,
  PRIVATE_CHANNEL_EVENT_TYPE_VALUES,
  PRIVATE_CHANNEL_EVENT_TYPES,
} from "@sdp/types";
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
    authUrl: z.string().openapi({ description: "Base URL of the SPC auth service." }),
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
    authUrl: z.string().min(1),
  })
  .openapi({ description: "Probe request body: the three URLs the connect flow re-probes." });

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
    auth: z.object({ reachable: z.boolean(), error: z.string().nullable() }),
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
    auth: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), latencyMs: z.number() }),
      z.object({ ok: z.literal(false), latencyMs: z.number(), error: z.string() }),
    ]),
  })
  .openapi({ description: "Full connect-time probe result (gateway + chain RPC + auth)." });

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

export const privateChannelBalanceQuerySchema = z.object({
  owner: z
    .string()
    .min(1)
    .openapi({
      param: { name: "owner", in: "query" },
      description:
        "Owner to read the balance for: a `walletId` from GET /v1/wallets, a wallet public key, or a raw Solana address.",
      example: "7C1Pu8mbHaDDTFnGH8YTqemNDofqXP3XEotzSo6TbwHz",
    }),
  mint: solanaAddressSchema.optional().openapi({
    param: { name: "mint", in: "query" },
    description: "Token mint to read. Defaults to the instance cluster's USDC mint.",
  }),
});

export const privateChannelBalanceSchema = z
  .object({
    owner: solanaAddressSchema,
    mint: solanaAddressSchema,
    tokenAccount: solanaAddressSchema.openapi({
      description: "The classic-Token associated-token account probed on the channel.",
    }),
    amount: z.string().openapi({ description: "Raw base-unit amount.", example: "1500000" }),
    decimals: z.number().openapi({ example: 6 }),
    uiAmount: z.string().openapi({ description: "Human-readable amount.", example: "1.5" }),
  })
  .openapi({
    description:
      "An owner's channel token balance (per wallet+mint, via the gateway). Shared across the wallet's channels.",
  });

export const privateChannelDepositSchema = z
  .object({
    id: z.string().openapi({ example: "dep_9f1c..." }),
    instanceId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    walletId: z.string().openapi({ description: "Custody wallet the deposit is signed from." }),
    depositor: solanaAddressSchema,
    recipient: solanaAddressSchema.openapi({
      description: "Address credited in the channel (defaults to the depositor).",
    }),
    mint: solanaAddressSchema,
    amount: z.string().openapi({ description: "Decimal amount.", example: "1.5" }),
    status: z
      .enum(["prepared", "submitted", "confirmed", "credited", "failed"])
      .openapi({ description: "Deposit lifecycle status.", example: "confirmed" }),
    signature: z
      .string()
      .nullable()
      .openapi({ description: "Devnet escrow tx signature (null until submitted)." }),
    failureReason: z.string().nullable().openapi({ description: "Set when status is failed." }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi({ description: "A Private Channels deposit intent." });

export const privateChannelDepositListSchema = z.object({
  deposits: z.array(privateChannelDepositSchema),
});

export const createPrivateChannelDepositBodySchema = z
  .object({
    walletId: z.string().min(1).openapi({
      description: "Source custody wallet (walletId or public key).",
      example: "wlt_…",
    }),
    amount: z
      .string()
      .min(1)
      .openapi({ description: "Decimal amount to deposit.", example: "1.5" }),
    recipient: z.string().min(1).optional().openapi({
      description: "Address/walletId to credit in the channel. Defaults to the depositor.",
    }),
  })
  .openapi({ description: "Create a deposit into the channel escrow." });

export const privateChannelDepositIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: "id", in: "path" },
      description: "Deposit id.",
      example: "dep_9f1c...",
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

export const privateChannelVerifyWalletParamSchema = z.object({
  walletId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "walletId", in: "path" },
      description: "SDP managed custody wallet id to verify.",
      example: "wallet_123",
    }),
});

export const privateChannelDeleteWalletParamSchema = z.object({
  pubkey: z
    .string()
    .min(1)
    .openapi({
      param: { name: "pubkey", in: "path" },
      description: "Verified wallet pubkey (base58) to revoke.",
      example: "7C1Pu8...",
    }),
});

export const privateChannelEventFamilySchema = z.enum(PRIVATE_CHANNEL_EVENT_FAMILY_VALUES);

export const privateChannelEventStatusSchema = z.enum(PRIVATE_CHANNEL_EVENT_STATUS_VALUES);

export const privateChannelEventTypeSchema = z
  .enum(PRIVATE_CHANNEL_EVENT_TYPE_VALUES)
  .openapi({ example: PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED });

export const privateChannelEventSchema = z
  .object({
    id: z.string().openapi({ example: "pce_9f1c..." }),
    organizationId: z.string(),
    projectId: z.string(),
    instanceId: z.string(),
    channelId: z.string().nullable(),
    sdpUserId: z.string().nullable(),
    family: privateChannelEventFamilySchema,
    type: privateChannelEventTypeSchema,
    status: privateChannelEventStatusSchema,
    payload: z.record(z.string(), z.unknown()),
    occurredAt: z.string(),
    createdAt: z.string(),
  })
  .openapi({ description: "A Private Channels activity event." });

export const privateChannelEventListSchema = z.object({
  events: z.array(privateChannelEventSchema),
  hasMore: z.boolean(),
  nextCursor: z
    .string()
    .nullable()
    .openapi({ description: "Opaque cursor for the next page; null when there are no more." }),
});

export const privateChannelEventsQuerySchema = z.object({
  family: privateChannelEventFamilySchema.optional().openapi({
    param: { name: "family", in: "query" },
    description: "Filter by event family.",
  }),
  type: z
    .string()
    .min(1)
    .optional()
    .openapi({
      param: { name: "type", in: "query" },
      description: `Exact event type match (e.g. ${PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED}).`,
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      description: "Page size (default 50, max 100).",
    }),
  before: z
    .string()
    .min(1)
    .optional()
    .openapi({
      param: { name: "before", in: "query" },
      description: "Opaque pagination cursor from a previous response's nextCursor.",
    }),
});
