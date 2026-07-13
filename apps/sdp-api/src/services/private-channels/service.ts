/**
 * Private-channels domain service.
 *
 * Orchestrates the `@sdp/private-channels` transport client with SDP-owned
 * concerns: instance config resolution and gateway health probing.
 */

import { type GatewayHealthResult, probeGatewayHealth } from "@sdp/private-channels";
import type { PrivateChannelHealth, PrivateChannelInstanceInfo } from "@sdp/types";
import type { Env } from "@/types/env";
import { getPrivateChannelConfig } from "./config";

/** Connect + health snapshot for the configured SPC instance. */
export async function getInstanceInfo(env: Env): Promise<PrivateChannelInstanceInfo> {
  const config = getPrivateChannelConfig(env);
  const health = await probeGatewayHealth(config.gatewayUrl);

  return {
    gatewayUrl: config.gatewayUrl,
    authMode: config.authMode,
    network: config.network,
    healthy: health.health?.ok === true,
    ready: health.ready?.ok === true,
    ...(config.escrowProgramId ? { escrowProgramId: config.escrowProgramId } : {}),
    ...(config.withdrawProgramId ? { withdrawProgramId: config.withdrawProgramId } : {}),
    ...(config.escrowInstance ? { escrowInstance: config.escrowInstance } : {}),
    ...(config.usdcMint ? { usdcMint: config.usdcMint } : {}),
  };
}

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
