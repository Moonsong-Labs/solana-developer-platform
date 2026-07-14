import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import {
  errorResponseSchema,
  privateChannelHealthQuerySchema,
  privateChannelHealthSchema,
  privateChannelInstanceSchema,
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
}
