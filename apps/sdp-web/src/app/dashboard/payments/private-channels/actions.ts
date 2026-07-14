"use server";

import type { PrivateChannelHealth } from "@sdp/types";
import { probePrivateChannelHealth } from "@/lib/private-channels";
import { createSdpApiClient } from "@/lib/sdp-api";

/**
 * Probe a candidate gateway via the sdp-api `/v1/private-channels/health`
 * endpoint (authenticated, project-scoped) rather than reaching the gateway
 * directly. The endpoint returns 200 with the `PrivateChannelHealth` DTO for
 * every probe outcome; if the API call itself fails (auth/network), reconstruct an
 * `unreachable` result so the form UX stays intact.
 */
export async function testGatewayHealthAction(gatewayUrl: string): Promise<PrivateChannelHealth> {
  try {
    const client = await createSdpApiClient();
    return await probePrivateChannelHealth(client, gatewayUrl);
  } catch (error) {
    return {
      status: "unreachable",
      latencyMs: 0,
      error: error instanceof Error ? error.message : "Failed to reach the SDP API.",
    };
  }
}
