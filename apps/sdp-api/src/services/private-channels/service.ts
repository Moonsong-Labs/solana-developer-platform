import { type GatewayHealthResult, probeGatewayHealth } from "@sdp/private-channels";
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

/** Probe a candidate gateway URL (the connect-form pre-connect test) → wire DTO. */
export async function probeInstanceHealth(gatewayUrl: string): Promise<PrivateChannelHealth> {
  return toHealthDto(await probeGatewayHealth(gatewayUrl));
}
