"use server";

import { type GatewayHealthResult, probeGatewayHealth } from "@sdp/private-channels/health";
import { isPrivateChannelsDashboardEnabled } from "@/lib/private-channels-feature";

export async function testGatewayHealthAction(gatewayUrl: string): Promise<GatewayHealthResult> {
  if (!isPrivateChannelsDashboardEnabled()) {
    return {
      status: "unreachable",
      latencyMs: 0,
      error: "Private Channels dashboard is disabled.",
    };
  }
  return probeGatewayHealth(gatewayUrl);
}
