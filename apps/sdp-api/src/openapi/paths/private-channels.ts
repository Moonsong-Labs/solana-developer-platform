import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import {
  errorResponseSchema,
  privateChannelHealthQuerySchema,
  privateChannelHealthSchema,
  privateChannelInstanceInputSchema,
  privateChannelInstanceSchema,
  privateChannelProbeBodySchema,
  privateChannelProbeResultSchema,
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
}
