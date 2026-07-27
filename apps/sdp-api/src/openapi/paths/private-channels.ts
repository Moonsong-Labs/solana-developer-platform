import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import {
  createPrivateChannelBodySchema,
  createPrivateChannelDepositBodySchema,
  createPrivateChannelWithdrawalBodySchema,
  errorResponseSchema,
  privateChannelBalanceQuerySchema,
  privateChannelBalanceSchema,
  privateChannelDeleteWalletParamSchema,
  privateChannelDepositIdParamSchema,
  privateChannelDepositListSchema,
  privateChannelDepositSchema,
  privateChannelEventListSchema,
  privateChannelEventsQuerySchema,
  privateChannelHealthQuerySchema,
  privateChannelHealthSchema,
  privateChannelIdParamSchema,
  privateChannelInstanceInputSchema,
  privateChannelInstanceSchema,
  privateChannelListSchema,
  privateChannelMembershipParamsSchema,
  privateChannelMembershipSchema,
  privateChannelOverviewSchema,
  privateChannelProbeBodySchema,
  privateChannelProbeResultSchema,
  privateChannelSchema,
  privateChannelVerifiedWalletListSchema,
  privateChannelVerifiedWalletSchema,
  privateChannelVerifyWalletParamSchema,
  privateChannelWithdrawalIdParamSchema,
  privateChannelWithdrawalListSchema,
  privateChannelWithdrawalSchema,
  successResponseSchema,
  updatePrivateChannelMembershipRoleBodySchema,
  z,
} from "../schemas";
import { errorResponses, jsonContent, projectScopeHeaders } from "./helpers";

const TAG = "Private Channels";

export function registerPrivateChannelsPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/instance",
    tags: [TAG],
    summary: "Get the active Private Channels instance for the project",
    operationId: "getPrivateChannelInstance",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Active instance, or null when none is connected.",
        content: jsonContent(
          successResponseSchema(z.object({ instance: privateChannelInstanceSchema.nullable() }))
        ),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/instance",
    tags: [TAG],
    summary: "Connect a Private Channels instance",
    operationId: "connectPrivateChannelInstance",
    description:
      "Server-probes both the gateway (/health + /ready) and the chain RPC (getVersion) before persisting. Returns 409 with `requiresReactivateConfirmation` if the gateway URL matches a previously-connected inactive row.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      body: {
        content: jsonContent(privateChannelInstanceInputSchema),
      },
    },
    responses: {
      200: {
        description: "The newly active instance.",
        content: jsonContent(
          successResponseSchema(z.object({ instance: privateChannelInstanceSchema }))
        ),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 409, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/instance/overview",
    tags: [TAG],
    summary: "Post-connect instance overview (gateway health + chain reads)",
    operationId: "getPrivateChannelOverview",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Active instance + overview snapshot.",
        content: jsonContent(
          successResponseSchema(
            z.object({
              instance: privateChannelInstanceSchema,
              overview: privateChannelOverviewSchema,
            })
          )
        ),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/instance/disconnect",
    tags: [TAG],
    summary: "Disconnect the active Private Channels instance",
    operationId: "disconnectPrivateChannelInstance",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "The row that was disconnected (is_active=false).",
        content: jsonContent(
          successResponseSchema(z.object({ instance: privateChannelInstanceSchema }))
        ),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/v1/private-channels/instance",
    tags: [TAG],
    summary: "Delete the active Private Channels instance",
    operationId: "deletePrivateChannelInstance",
    description: "Hard-deletes the active row. Downstream FKs cascade.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Deletion result.",
        content: jsonContent(successResponseSchema(z.object({ deleted: z.literal(true) }))),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/probe",
    tags: [TAG],
    summary: "Probe a candidate SPC configuration",
    operationId: "probePrivateChannelConnection",
    description:
      "Full pre-connect probe: gateway `/health` + `/ready` and chain RPC `getVersion`. Always 200 with the raw probe result; only a malformed body is 400. The Connect handler runs the same probe internally, so `probe.ok === true` here means Connect will not fail on the probe step.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      body: { content: jsonContent(privateChannelProbeBodySchema) },
    },
    responses: {
      200: {
        description: "Full connect-time probe result.",
        content: jsonContent(successResponseSchema(privateChannelProbeResultSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/health",
    tags: [TAG],
    summary: "Probe a candidate gateway's health",
    operationId: "getPrivateChannelHealth",
    description:
      "Pre-connect test of a caller-supplied gateway URL. Always 200 with a discriminated PrivateChannelHealth DTO (ready/degraded/unreachable); only a missing gatewayUrl is 400.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, query: privateChannelHealthQuerySchema },
    responses: {
      200: {
        description: "Gateway health probe result.",
        content: jsonContent(successResponseSchema(privateChannelHealthSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/balance",
    tags: [TAG],
    summary: "Read an owner's channel token balance",
    operationId: "getPrivateChannelBalance",
    description:
      "Reads an owner's token balance on the channel via the gateway (per wallet+mint; shared across the wallet's channels). `owner` accepts a walletId, wallet public key, or raw address; `mint` defaults to the instance cluster's USDC mint. A never-credited owner reads as a zero balance.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, query: privateChannelBalanceQuerySchema },
    responses: {
      200: {
        description: "The owner's channel token balance.",
        content: jsonContent(successResponseSchema(privateChannelBalanceSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/deposits",
    tags: [TAG],
    summary: "Create a deposit into the channel escrow",
    operationId: "createPrivateChannelDeposit",
    description:
      "Builds, server-signs, and broadcasts an escrow deposit from a custody wallet to the instance chain (devnet), crediting `recipient` (defaults to the depositor) in the channel. Returns the deposit with its current status (submitted/confirmed, or failed). The credit (`credited`) is detected asynchronously via the gateway balance.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      body: { content: jsonContent(createPrivateChannelDepositBodySchema) },
    },
    responses: {
      200: {
        description: "The created deposit.",
        content: jsonContent(successResponseSchema(privateChannelDepositSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/deposits",
    tags: [TAG],
    summary: "List deposits for the project",
    operationId: "listPrivateChannelDeposits",
    description: "Lists the project's deposits, newest first.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Deposits",
        content: jsonContent(successResponseSchema(privateChannelDepositListSchema)),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/deposits/{id}",
    tags: [TAG],
    summary: "Get a deposit",
    operationId: "getPrivateChannelDeposit",
    description: "Reads one deposit for the project (poll this for status transitions).",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, params: privateChannelDepositIdParamSchema },
    responses: {
      200: {
        description: "The deposit.",
        content: jsonContent(successResponseSchema(privateChannelDepositSchema)),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/withdrawals",
    tags: [TAG],
    summary: "Create a withdrawal from the channel balance",
    operationId: "createPrivateChannelWithdrawal",
    description:
      "Server-signs a burn of the custody wallet's channel-chain balance and broadcasts it to the gateway; the operator later releases the matching real USDC on devnet to `destination` (defaults to the owner). Returns the withdrawal with its current status (submitted/burn_confirmed, or failed). The release (`released`) is detected asynchronously from the devnet release on the instance ATA.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      body: { content: jsonContent(createPrivateChannelWithdrawalBodySchema) },
    },
    responses: {
      200: {
        description: "The created withdrawal.",
        content: jsonContent(successResponseSchema(privateChannelWithdrawalSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/withdrawals",
    tags: [TAG],
    summary: "List withdrawals for the project",
    operationId: "listPrivateChannelWithdrawals",
    description: "Lists the project's withdrawals, newest first.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Withdrawals",
        content: jsonContent(successResponseSchema(privateChannelWithdrawalListSchema)),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/withdrawals/{id}",
    tags: [TAG],
    summary: "Get a withdrawal",
    operationId: "getPrivateChannelWithdrawal",
    description: "Reads one withdrawal for the project (poll this for status transitions).",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, params: privateChannelWithdrawalIdParamSchema },
    responses: {
      200: {
        description: "The withdrawal.",
        content: jsonContent(successResponseSchema(privateChannelWithdrawalSchema)),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/channels",
    tags: [TAG],
    summary: "List channels for the connected instance",
    operationId: "listPrivateChannels",
    description:
      "Lists logical channels for the project's active instance (newest first). Ensures the auto-provisioned `default` channel exists.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Channels",
        content: jsonContent(successResponseSchema(privateChannelListSchema)),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/channels",
    tags: [TAG],
    summary: "Create a channel",
    operationId: "createPrivateChannel",
    description:
      "Creates a named channel in the project's active instance. Names are unique per instance.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      body: { content: jsonContent(createPrivateChannelBodySchema) },
    },
    responses: {
      201: {
        description: "Created channel",
        content: jsonContent(successResponseSchema(privateChannelSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 409, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/channels/{id}",
    tags: [TAG],
    summary: "Get a channel",
    operationId: "getPrivateChannel",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, params: privateChannelIdParamSchema },
    responses: {
      200: {
        description: "Channel",
        content: jsonContent(successResponseSchema(privateChannelSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/channels/{id}/events",
    tags: [TAG],
    summary: "List activity events for a channel",
    operationId: "listPrivateChannelEvents",
    description:
      "Paginated activity feed for a channel (newest first). Includes instance-level lifecycle events (channel_id null) for the active instance. Paginate with the opaque `before` cursor from `nextCursor`.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      params: privateChannelIdParamSchema,
      query: privateChannelEventsQuerySchema,
    },
    responses: {
      200: {
        description: "Events page",
        content: jsonContent(successResponseSchema(privateChannelEventListSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/events",
    tags: [TAG],
    summary: "List activity events for the project",
    operationId: "listProjectPrivateChannelEvents",
    description:
      "Project-scoped activity feed across all instances and channels (newest first). Instance-independent, so retained history stays readable after an instance is deleted. Paginate with the opaque `before` cursor from `nextCursor`.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      query: privateChannelEventsQuerySchema,
    },
    responses: {
      200: {
        description: "Events page",
        content: jsonContent(successResponseSchema(privateChannelEventListSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 500]),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/v1/private-channels/channels/{id}",
    tags: [TAG],
    summary: "Archive a channel",
    operationId: "deletePrivateChannel",
    description:
      "Archives a channel. Requires project-admin or channel-owner access. The auto-provisioned default channel cannot be archived.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, params: privateChannelIdParamSchema },
    responses: {
      204: { description: "Archived" },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 409, 500, 503]),
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/v1/private-channels/channels/{channelId}/memberships/{privateChannelUserId}",
    tags: [TAG],
    summary: "Update a channel membership role",
    operationId: "updatePrivateChannelMembershipRole",
    description:
      "Changes an existing membership between owner, admin, member, and viewer. Owner assignment atomically transfers ownership and is restricted to the current owner; other role changes require project-admin, channel-owner, or channel-admin access. Viewer currently behaves like member — it does not yet restrict deposits or withdrawals.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      params: privateChannelMembershipParamsSchema,
      body: { content: jsonContent(updatePrivateChannelMembershipRoleBodySchema) },
    },
    responses: {
      200: {
        description: "Updated membership",
        content: jsonContent(
          successResponseSchema(z.object({ membership: privateChannelMembershipSchema }))
        ),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 409, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/wallets",
    tags: [TAG],
    summary: "List the caller's verified wallets",
    operationId: "listPrivateChannelVerifiedWallets",
    description:
      "Lists the caller's own custody wallets that have completed SPC verification for this project.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Verified wallets",
        content: jsonContent(successResponseSchema(privateChannelVerifiedWalletListSchema)),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/wallets/{walletId}/verify",
    tags: [TAG],
    summary: "Verify a custody wallet with the SPC auth service",
    operationId: "verifyPrivateChannelWallet",
    description:
      "Runs the SPC challenge → sign → verify handshake for a custody wallet (any SDP provider), then records the verification. A member may verify many wallets; idempotent per (member, instance, wallet). Requires the caller to be an invited member of the connected instance.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, params: privateChannelVerifyWalletParamSchema },
    responses: {
      200: {
        description: "The verified wallet.",
        content: jsonContent(
          successResponseSchema(z.object({ wallet: privateChannelVerifiedWalletSchema }))
        ),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/v1/private-channels/wallets/{pubkey}",
    tags: [TAG],
    summary: "Revoke a verified wallet",
    operationId: "deletePrivateChannelVerifiedWallet",
    description:
      "Revokes a wallet verification with the SPC auth service and removes the SDP mirror row. Requires the caller to be an invited member of the connected instance.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, params: privateChannelDeleteWalletParamSchema },
    responses: {
      200: {
        description: "The wallet verification was revoked.",
        content: jsonContent(successResponseSchema(z.object({ deleted: z.boolean() }))),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });
}
