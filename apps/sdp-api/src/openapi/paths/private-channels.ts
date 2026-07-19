import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import {
  createPrivateChannelBodySchema,
  errorResponseSchema,
  privateChannelEventListSchema,
  privateChannelEventsQuerySchema,
  privateChannelHealthQuerySchema,
  privateChannelHealthSchema,
  privateChannelIdParamSchema,
  privateChannelInstanceInputSchema,
  privateChannelInstanceSchema,
  privateChannelListSchema,
  privateChannelOverviewSchema,
  privateChannelProbeBodySchema,
  privateChannelProbeResultSchema,
  privateChannelSchema,
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
    summary: "Delete a channel",
    operationId: "deletePrivateChannel",
    description: "Deletes a channel. The auto-provisioned default channel cannot be deleted.",
    security: [{ apiKeyAuth: [] }],
    request: { headers: projectScopeHeaders, params: privateChannelIdParamSchema },
    responses: {
      204: { description: "Deleted" },
      ...errorResponses(errorResponseSchema, [400, 401, 403, 404, 409, 500, 503]),
    },
  });
}
