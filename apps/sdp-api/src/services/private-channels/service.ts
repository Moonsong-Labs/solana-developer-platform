import {
  type ConnectionProbeInput,
  type ConnectionProbeResult,
  type GatewayHealthResult,
  probeConnection,
  probeGatewayHealth,
} from "@sdp/private-channels";
import type { PrivateChannelHealth } from "@sdp/types";

/** Map the engine probe result to the JSON-safe wire DTO (drops sub-responses). */
function toHealthDto(result: GatewayHealthResult): PrivateChannelHealth {
  if (result.status === "degraded") {
    return { status: "degraded", latencyMs: result.latencyMs, reason: result.reason };
  }
  if (result.status === "unreachable") {
    return { status: "unreachable", latencyMs: result.latencyMs, error: result.error };
  }
  return { status: "ready", latencyMs: result.latencyMs };
}

/** Pre-connect gateway probe (candidate URL from the connect form) → wire DTO. */
export async function probeInstanceHealth(gatewayUrl: string): Promise<PrivateChannelHealth> {
  return toHealthDto(await probeGatewayHealth(gatewayUrl));
}

/**
 * Full connect-time verification: gateway (`/health` + `/ready`) AND chain RPC
 * (`getVersion`). Returned raw so the caller can attach both sub-results to a
 * 400 response for the client's status badges.
 */
export async function verifyInstanceConnection(
  input: ConnectionProbeInput
): Promise<ConnectionProbeResult> {
  return probeConnection(input);
}
