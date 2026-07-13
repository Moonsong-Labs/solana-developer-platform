import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import {
  errorResponseSchema,
  privateChannelBalanceSchema,
  privateChannelBalancesQuerySchema,
  privateChannelHealthQuerySchema,
  privateChannelHealthSchema,
  privateChannelInstanceSchema,
  privateChannelTransferRequestSchema,
  privateChannelTransferResultSchema,
  successResponseSchema,
  z,
} from "../schemas";
import { errorResponses, jsonContent, projectScopeHeaders } from "./helpers";

const TAG = "Private Channels";

export function registerPrivateChannelsPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/instance",
    tags: [TAG],
    summary: "Get the connected Private Channels instance",
    operationId: "getPrivateChannelInstance",
    description:
      "Returns the connected SPC instance's gateway URL, auth mode, network, and gateway health/readiness.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders },
    responses: {
      200: {
        description: "Instance info",
        content: jsonContent(
          successResponseSchema(z.object({ instance: privateChannelInstanceSchema }))
        ),
      },
      ...errorResponses(errorResponseSchema, [401, 403, 500, 503]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/health",
    tags: [TAG],
    summary: "Probe a candidate gateway's health",
    operationId: "getPrivateChannelHealth",
    description:
      "Probes a candidate SPC gateway's /health and /ready (a pre-connect test). Returns 200 with the probe result for all outcomes (ready/degraded/unreachable).",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, query: privateChannelHealthQuerySchema },
    responses: {
      200: {
        description: "Gateway health probe result",
        content: jsonContent(successResponseSchema(privateChannelHealthSchema)),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/private-channels/balances",
    tags: [TAG],
    summary: "List channel balances for a wallet",
    operationId: "getPrivateChannelBalances",
    description:
      "Reads channel balances for a wallet across a mint set, deriving each ATA (the gateway does not implement getTokenAccountsByOwner).",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, query: privateChannelBalancesQuerySchema },
    responses: {
      200: {
        description: "Channel balances",
        content: jsonContent(
          successResponseSchema(z.object({ balances: z.array(privateChannelBalanceSchema) }))
        ),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 500, 503]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/private-channels/transfers",
    tags: [TAG],
    summary: "Execute an internal channel transfer",
    operationId: "createPrivateChannelTransfer",
    description:
      "Builds, custody-signs, submits, and confirms an internal SPL transfer on the channel. The source must be an SDP-managed custody wallet.",
    security: [{ apiKeyAuth: [] }],
    request: {
      headers: projectScopeHeaders,
      body: { required: true, content: jsonContent(privateChannelTransferRequestSchema) },
    },
    responses: {
      200: {
        description: "Transfer result",
        content: jsonContent(
          successResponseSchema(z.object({ transfer: privateChannelTransferResultSchema }))
        ),
      },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 500, 503]),
    },
  });
}
