import type { PrivateChannelHealth } from "@sdp/types";
import type { SdpApiClient } from "@/lib/sdp-api";

/**
 * Probe a candidate SPC gateway's health via the sdp-api
 * `GET /v1/private-channels/health` endpoint. Encapsulates the path + response
 * type so callers work with a typed function, not a raw URL (mirrors
 * `fetchProviderAvailability` and the other `lib/*` API wrappers).
 */
export function probePrivateChannelHealth(
  client: SdpApiClient,
  gatewayUrl: string
): Promise<PrivateChannelHealth> {
  return client.fetch<PrivateChannelHealth>(
    `/v1/private-channels/health?gatewayUrl=${encodeURIComponent(gatewayUrl)}`
  );
}
